package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"reader/internal/domain"
)

const (
	defaultRefreshConcurrency  = 5
	refreshInterval            = 30 * time.Minute
	defaultRefreshPollInterval = time.Minute
	releaseMaxAttempts         = 3
	defaultReleaseBaseBackoff  = 50 * time.Millisecond
)

type RefreshConfig struct {
	Feeds       domain.FeedRepository
	Fetcher     domain.FeedFetcher
	Parser      domain.FeedParser
	Concurrency int
	// PollInterval is how often idle workers look for due feeds without a Wake.
	PollInterval time.Duration
	Now          func() time.Time
	OnFatal      func(error)
}

// RefreshQueue refreshes due feeds through a bounded worker pool. The database
// is the queue: each worker claims one due feed at a time, so no in-memory
// queue or dedupe state exists.
type RefreshQueue struct {
	feeds              domain.FeedRepository
	fetcher            domain.FeedFetcher
	parser             domain.FeedParser
	concurrency        int
	pollInterval       time.Duration
	releaseBaseBackoff time.Duration
	now                func() time.Time
	onFatal            func(error)

	// Consecutive database failures, counted per path: an empty claim by one
	// worker says nothing about another worker's failing refresh.
	claimFailures   atomic.Int32
	refreshFailures atomic.Int32

	wake chan struct{}
	wg   sync.WaitGroup
}

func NewRefreshQueue(cfg RefreshConfig) *RefreshQueue {
	concurrency := cfg.Concurrency
	if concurrency <= 0 {
		concurrency = defaultRefreshConcurrency
	}

	pollInterval := cfg.PollInterval
	if pollInterval <= 0 {
		pollInterval = defaultRefreshPollInterval
	}

	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	return &RefreshQueue{
		feeds:              cfg.Feeds,
		fetcher:            cfg.Fetcher,
		parser:             cfg.Parser,
		concurrency:        concurrency,
		pollInterval:       pollInterval,
		releaseBaseBackoff: defaultReleaseBaseBackoff,
		now:                now,
		onFatal:            cfg.OnFatal,
		wake:               make(chan struct{}, 1),
	}
}

// Wake asks an idle worker to look for due feeds. It never blocks, and wakes
// that arrive while a signal is already pending coalesce into it.
func (q *RefreshQueue) Wake() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// Start launches the worker pool and the scheduler tick, and wakes the pool once
// so overdue feeds refresh immediately. They run until ctx is canceled.
func (q *RefreshQueue) Start(ctx context.Context) {
	for range q.concurrency {
		q.wg.Add(1)

		go func() {
			defer q.wg.Done()
			q.work(ctx)
		}()
	}

	q.wg.Add(1)

	go func() {
		defer q.wg.Done()
		q.runScheduler(ctx)
	}()

	q.Wake()
}

// Wait blocks until all workers and the scheduler started by Start have exited.
func (q *RefreshQueue) Wait() {
	q.wg.Wait()
}

func (q *RefreshQueue) runScheduler(ctx context.Context) {
	tickLoop(ctx, q.pollInterval, func(context.Context) { q.Wake() })
}

func (q *RefreshQueue) work(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-q.wake:
			q.drain(ctx)
		}
	}
}

// drain claims and refreshes due feeds until none is due, the database failed,
// or ctx is canceled. Every claim wakes another idle worker so a backlog of due
// feeds is shared across the pool.
func (q *RefreshQueue) drain(ctx context.Context) {
	for ctx.Err() == nil {
		attemptID := domain.NewID()

		feed, err := q.feeds.ClaimDueRefresh(ctx, attemptID, q.now().UTC())
		if err != nil {
			if ctx.Err() == nil {
				q.recordDBFailure(&q.claimFailures, "claim due feed refresh failed", err)
			}

			return
		}

		q.claimFailures.Store(0)

		if feed == nil {
			return
		}

		q.Wake()

		// After a database error the worker waits for the next wake or tick
		// instead of immediately re-claiming the feed it just released.
		if !q.refresh(ctx, attemptID, *feed) {
			return
		}
	}
}

// refresh runs one claimed attempt to a final state: succeeded or failed for
// external outcomes, released for internal database errors so the feed stays
// due. On shutdown it writes nothing and startup recovery marks the attempt
// interrupted. It reports whether the attempt was recorded.
func (q *RefreshQueue) refresh(ctx context.Context, attemptID string, feed domain.Feed) bool {
	parsed, err := q.fetchAndParse(ctx, feed.URL)
	if ctx.Err() != nil {
		return false
	}

	finishedAt := q.now().UTC()
	nextRefreshAt := finishedAt.Add(refreshInterval)

	if err == nil {
		meta := domain.FeedSyncMeta{
			Title:   resolveFeedTitle(parsed.Title, feed),
			SiteURL: parsed.SiteURL,
			IconURL: parsed.IconURL,
		}

		// The repository plans item changes using the retention in its write transaction.
		err = q.feeds.SucceedRefresh(ctx, attemptID, feed.ID, meta, parsed.Entries, finishedAt, nextRefreshAt)
	} else {
		logFailure(slog.LevelWarn, "feed refresh failed", err, "feed_id", feed.ID)

		err = q.feeds.FailRefresh(ctx, attemptID, feed.ID, domain.SanitizeErrorText(err.Error()), finishedAt, nextRefreshAt)
	}

	if err == nil {
		q.refreshFailures.Store(0)

		return true
	}

	if ctx.Err() == nil {
		q.recordDBFailure(&q.refreshFailures, "feed refresh failed", err, "feed_id", feed.ID)
		q.releaseClaim(ctx, attemptID, feed.ID)
	}

	return false
}

func (q *RefreshQueue) fetchAndParse(ctx context.Context, url domain.NormalizedURL) (domain.ParsedFeed, error) {
	body, finalURL, err := q.fetcher.FetchFeed(ctx, url)
	if err != nil {
		return domain.ParsedFeed{}, err
	}

	return q.parseFeed(body, finalURL)
}

// parseFeed turns a parser panic on untrusted feed bytes into an external
// FeedParserError so one hostile feed cannot crash-loop the process.
func (q *RefreshQueue) parseFeed(body []byte, finalURL string) (parsed domain.ParsedFeed, err error) {
	defer func() {
		if recover() != nil {
			parsed, err = domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("feed parser panicked"))
		}
	}()

	return q.parser.ParseFeed(body, finalURL)
}

func resolveFeedTitle(parsedTitle string, feed domain.Feed) string {
	if title := strings.TrimSpace(parsedTitle); title != "" {
		return title
	}

	if title := strings.TrimSpace(feed.Title); title != "" {
		return title
	}

	return feed.URL.Host()
}

// releaseClaim gives a claimed feed back after a database error so it stays
// due. A release that keeps failing leaves the feed marked running until the
// next startup, so it is fatal unless the process is shutting down.
func (q *RefreshQueue) releaseClaim(ctx context.Context, attemptID string, feedID string) {
	backoff := q.releaseBaseBackoff

	var err error

	for attempt := 1; attempt <= releaseMaxAttempts; attempt++ {
		err = q.feeds.ReleaseRefresh(ctx, attemptID, feedID)
		if err == nil || ctx.Err() != nil {
			return
		}

		logFailure(slog.LevelError, "release feed refresh failed", err, "feed_id", feedID, "attempt", attempt)

		if attempt == releaseMaxAttempts || !sleepWithContext(ctx, backoff) {
			break
		}

		backoff *= 2
	}

	if ctx.Err() == nil {
		q.onFatal(fmt.Errorf("release feed refresh feed_id=%s: %w", feedID, sanitizedError{cause: err}))
	}
}

func (q *RefreshQueue) recordDBFailure(streak *atomic.Int32, msg string, err error, attrs ...any) {
	logFailure(slog.LevelError, msg, err, attrs...)

	if streak.Add(1) == fatalFailureStreak {
		q.onFatal(fmt.Errorf("feed refresh database failed %d consecutive times: %w", fatalFailureStreak, sanitizedError{cause: err}))
	}
}

func isCanceled(ctx context.Context, err error) bool {
	return ctx.Err() != nil || errors.Is(err, context.Canceled)
}

func isDatabaseError(err error) bool {
	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		return false
	}

	switch domainErr.Code {
	case domain.ErrFeedRepositoryError, domain.ErrSettingRepositoryError, domain.ErrFeedItemRepositoryError:
		return true
	default:
		return false
	}
}
