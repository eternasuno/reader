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
	defaultRefreshConcurrency = 5
	defaultRefreshInterval    = 30 * time.Minute
)

type RefreshConfig struct {
	Feeds       domain.FeedRepository
	FeedItems   domain.FeedItemRepository
	Settings    domain.SettingRepository
	Fetcher     domain.FeedFetcher
	Parser      domain.FeedParser
	Concurrency int
	Interval    time.Duration
	Now         func() time.Time
	OnFatal     func(error)
}

// RefreshQueue refreshes feeds through a bounded worker pool while deduplicating
// queued and running feed ids.
type RefreshQueue struct {
	feeds           domain.FeedRepository
	feedItems       domain.FeedItemRepository
	settings        domain.SettingRepository
	fetcher         domain.FeedFetcher
	parser          domain.FeedParser
	concurrency     int
	interval        time.Duration
	now             func() time.Time
	onFatal         func(error)
	dbFailureStreak atomic.Int32

	mu     sync.Mutex
	queue  []string
	queued map[string]struct{}
	notify chan struct{}
	wg     sync.WaitGroup
}

func NewRefreshQueue(cfg RefreshConfig) *RefreshQueue {
	concurrency := cfg.Concurrency
	if concurrency <= 0 {
		concurrency = defaultRefreshConcurrency
	}

	interval := cfg.Interval
	if interval <= 0 {
		interval = defaultRefreshInterval
	}

	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	return &RefreshQueue{
		feeds:       cfg.Feeds,
		feedItems:   cfg.FeedItems,
		settings:    cfg.Settings,
		fetcher:     cfg.Fetcher,
		parser:      cfg.Parser,
		concurrency: concurrency,
		interval:    interval,
		now:         now,
		onFatal:     cfg.OnFatal,
		queued:      make(map[string]struct{}),
		notify:      make(chan struct{}, 1),
	}
}

// Enqueue schedules feeds for refresh, dropping ids that are already queued or
// running.
func (q *RefreshQueue) Enqueue(feedIDs ...string) {
	q.mu.Lock()

	added := false
	for _, feedID := range feedIDs {
		if _, ok := q.queued[feedID]; ok {
			continue
		}

		q.queued[feedID] = struct{}{}
		q.queue = append(q.queue, feedID)
		added = true
	}

	q.mu.Unlock()

	if added {
		q.signal()
	}
}

func (q *RefreshQueue) EnqueueAll(ctx context.Context) error {
	feeds, err := q.feeds.List(ctx)
	if err != nil {
		if !isCanceled(ctx, err) && isDatabaseError(err) {
			q.recordDBFailure("enqueue feeds failed", err)
		}

		return err
	}

	q.dbFailureStreak.Store(0)

	feedIDs := make([]string, 0, len(feeds))
	for _, feed := range feeds {
		feedIDs = append(feedIDs, feed.ID)
	}

	q.Enqueue(feedIDs...)

	return nil
}

// RefreshOne fetches, parses, and syncs a single feed, recording a sanitized
// failure summary when an external step fails and tracking database errors.
func (q *RefreshQueue) RefreshOne(ctx context.Context, feedID string) error {
	err := q.refreshFeed(ctx, feedID)
	if err == nil {
		q.dbFailureStreak.Store(0)

		return nil
	}

	if isCanceled(ctx, err) {
		return err
	}

	if isDatabaseError(err) {
		q.recordDBFailure("feed refresh failed", err, "feed_id", feedID)

		return err
	}

	q.recordFailure(ctx, feedID, err)

	return err
}

func (q *RefreshQueue) refreshFeed(ctx context.Context, feedID string) error {
	feed, err := q.feeds.GetByID(ctx, feedID)
	if err != nil || feed == nil {
		return err
	}

	return q.syncFeed(ctx, *feed)
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

func (q *RefreshQueue) syncFeed(ctx context.Context, feed domain.Feed) error {
	// A settings read failure aborts the refresh: pruning with an unknown
	// retention setting could delete items the user asked to keep.
	settings, err := q.settings.Get(ctx)
	if err != nil {
		return err
	}

	body, finalURL, err := q.fetcher.FetchFeed(ctx, feed.URL)
	if err != nil {
		return err
	}

	parsed, err := q.parseFeed(body, finalURL)
	if err != nil {
		return err
	}

	storedRefs, err := q.feedItems.ListStoredRefsByFeed(ctx, feed.ID)
	if err != nil {
		return err
	}

	newItems, deleteIDs := domain.PlanFeedSync(feed.ID, parsed.Entries, storedRefs, settings.Retention, domain.NewID)

	return q.feeds.ApplySync(ctx, feed.ID, resolveFeedTitle(parsed.Title, feed), parsed.IconURL, q.now().UTC(), newItems, deleteIDs)
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

// Start launches the worker pool, refreshes every feed once, and keeps
// enqueueing all feeds on the configured interval until ctx is canceled.
func (q *RefreshQueue) Start(ctx context.Context) {
	for range q.concurrency {
		q.wg.Add(1)

		go func() {
			defer q.wg.Done()
			q.work(ctx)
		}()
	}

	q.enqueueAllLogged(ctx, "initial feed refresh enqueue failed")

	q.wg.Add(1)

	go func() {
		defer q.wg.Done()
		q.runScheduler(ctx)
	}()
}

// Wait blocks until all workers and the scheduler started by Start have exited.
func (q *RefreshQueue) Wait() {
	q.wg.Wait()
}

func (q *RefreshQueue) runScheduler(ctx context.Context) {
	tickLoop(ctx, q.interval, func(ctx context.Context) {
		q.enqueueAllLogged(ctx, "scheduled feed refresh enqueue failed")
	})
}

func (q *RefreshQueue) enqueueAllLogged(ctx context.Context, failureMessage string) {
	if err := q.EnqueueAll(ctx); shouldWarnRefreshError(ctx, err) {
		logFailure(slog.LevelWarn, failureMessage, err)
	}
}

func (q *RefreshQueue) work(ctx context.Context) {
	for {
		feedID, ok := q.next(ctx)
		if !ok {
			return
		}

		q.runRefreshJob(ctx, feedID)
	}
}

func (q *RefreshQueue) runRefreshJob(ctx context.Context, feedID string) {
	defer q.finish(feedID)

	if err := q.RefreshOne(ctx, feedID); shouldWarnRefreshError(ctx, err) {
		logFailure(slog.LevelWarn, "feed refresh failed", err, "feed_id", feedID)
	}
}

func (q *RefreshQueue) next(ctx context.Context) (string, bool) {
	for {
		if ctx.Err() != nil {
			return "", false
		}

		q.mu.Lock()
		if len(q.queue) > 0 {
			feedID := q.queue[0]
			q.queue[0] = ""
			q.queue = q.queue[1:]

			hasMore := len(q.queue) > 0
			q.mu.Unlock()

			if hasMore {
				q.signal()
			}

			return feedID, true
		}

		q.mu.Unlock()

		select {
		case <-ctx.Done():
			return "", false
		case <-q.notify:
		}
	}
}

func (q *RefreshQueue) finish(feedID string) {
	q.mu.Lock()
	delete(q.queued, feedID)
	q.mu.Unlock()
}

func (q *RefreshQueue) signal() {
	select {
	case q.notify <- struct{}{}:
	default:
	}
}

func (q *RefreshQueue) recordFailure(ctx context.Context, feedID string, err error) {
	recErr := q.feeds.RecordRefreshFailure(ctx, feedID, domain.SanitizeErrorText(err.Error()))
	if recErr == nil {
		q.dbFailureStreak.Store(0)

		return
	}

	if isCanceled(ctx, recErr) {
		return
	}

	if isDatabaseError(recErr) {
		q.recordDBFailure("record feed refresh failure failed", recErr, "feed_id", feedID)

		return
	}

	logFailure(slog.LevelWarn, "record feed refresh failure failed", recErr, "feed_id", feedID)
}

func (q *RefreshQueue) recordDBFailure(msg string, err error, attrs ...any) {
	logFailure(slog.LevelError, msg, err, attrs...)
	if q.dbFailureStreak.Add(1) == fatalFailureStreak {
		q.onFatal(fmt.Errorf("feed refresh database failed %d consecutive times: %w", fatalFailureStreak, sanitizedError{cause: err}))
	}
}

func shouldWarnRefreshError(ctx context.Context, err error) bool {
	return err != nil && !isCanceled(ctx, err) && !isDatabaseError(err)
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
