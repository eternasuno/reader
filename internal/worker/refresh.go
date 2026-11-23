package worker

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"reader/internal/domain"
)

const (
	defaultRefreshConcurrency = 5
	defaultRefreshInterval    = 30 * time.Minute
	maxLogErrorBytes          = 512
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
}

// RefreshQueue refreshes feeds through a bounded worker pool while deduplicating
// queued and running feed ids.
type RefreshQueue struct {
	feeds       domain.FeedRepository
	feedItems   domain.FeedItemRepository
	settings    domain.SettingRepository
	fetcher     domain.FeedFetcher
	parser      domain.FeedParser
	concurrency int
	interval    time.Duration
	now         func() time.Time

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
		queued:      make(map[string]struct{}),
		notify:      make(chan struct{}, 1),
	}
}

// Enqueue schedules feeds for refresh, dropping empty ids and ids that are
// already queued or running.
func (q *RefreshQueue) Enqueue(feedIDs ...string) {
	q.mu.Lock()

	added := false
	for _, feedID := range feedIDs {
		if feedID == "" {
			continue
		}

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
		return err
	}

	feedIDs := make([]string, 0, len(feeds))
	for _, feed := range feeds {
		feedIDs = append(feedIDs, feed.ID)
	}

	q.Enqueue(feedIDs...)

	return nil
}

// RefreshOne fetches, parses, and syncs a single feed, recording a sanitized
// failure summary when any step fails.
func (q *RefreshQueue) RefreshOne(ctx context.Context, feedID string) error {
	feed, err := q.feeds.GetByID(ctx, feedID)
	if err != nil || feed == nil {
		return err
	}

	if err := q.syncFeed(ctx, *feed); err != nil {
		if ctx.Err() == nil && !errors.Is(err, context.Canceled) {
			q.recordFailure(ctx, feedID, err)
		}

		return err
	}

	return nil
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

	parsed, err := q.parser.ParseFeed(body, finalURL)
	if err != nil {
		return err
	}

	storedRefs, err := q.feedItems.ListStoredRefsByFeed(ctx, feed.ID)
	if err != nil {
		return err
	}

	newItems, deleteIDs := domain.PlanFeedSync(feed.ID, parsed.Entries, storedRefs, settings.Retention, domain.NewID)

	return q.feeds.ApplySync(ctx, feed.ID, resolveFeedTitle(parsed.Title, feed), q.now().UTC(), newItems, deleteIDs)
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

	if err := q.EnqueueAll(ctx); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("initial feed refresh enqueue failed", "error", sanitizeLogError(err))
	}

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
	ticker := time.NewTicker(q.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := q.EnqueueAll(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.Warn("scheduled feed refresh enqueue failed", "error", sanitizeLogError(err))
			}
		}
	}
}

func (q *RefreshQueue) work(ctx context.Context) {
	for {
		feedID, ok := q.next(ctx)
		if !ok {
			return
		}

		if err := q.RefreshOne(ctx, feedID); err != nil && !errors.Is(err, context.Canceled) {
			slog.Warn("feed refresh failed", "feed_id", feedID, "error", sanitizeLogError(err))
		}

		q.finish(feedID)
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
	if recErr := q.feeds.RecordRefreshFailure(ctx, feedID, domain.SanitizeErrorText(err.Error())); recErr != nil && !errors.Is(recErr, context.Canceled) {
		slog.Warn("record feed refresh failure failed", "feed_id", feedID, "error", sanitizeLogError(recErr))
	}
}

func sanitizeLogError(err error) string {
	sanitized := strings.NewReplacer("\r", " ", "\n", " ").Replace(domain.SanitizeErrorText(err.Error()))
	if len(sanitized) <= maxLogErrorBytes {
		return sanitized
	}

	return sanitized[:maxLogErrorBytes] + "..."
}
