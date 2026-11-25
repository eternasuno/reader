package worker

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reader/internal/domain"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRefreshOneSyncsFeed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feed := domain.Feed{
		ID:         "feed-1",
		URL:        testURL(t, "https://example.com/feed.xml"),
		Title:      "Old Title",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}

	feeds := newTestFeedRepository(feed)
	settings := &fakeSettingRepository{settings: domain.Settings{Retention: 1}}
	fetcher := &fakeFeedFetcher{body: []byte("<rss>"), finalURL: "https://example.com/feed.xml"}
	parser := &fakeFeedParser{parsed: domain.ParsedFeed{
		Title: "Fresh Title",
		Entries: []domain.ParsedFeedEntry{
			parsedEntry(t, "https://example.com/one", "One"),
			parsedEntry(t, "https://example.com/two", "Two"),
		},
	}}
	items := &fakeFeedItemRepository{}

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: items,
		Settings:  settings,
		Fetcher:   fetcher,
		Parser:    parser,
		Now:       func() time.Time { return now },
	})

	if err := queue.RefreshOne(context.Background(), "feed-1"); err != nil {
		t.Fatalf("RefreshOne() error = %v", err)
	}

	if len(fetcher.calls) != 1 || fetcher.calls[0] != feed.URL.Raw() {
		t.Fatalf("fetched URLs = %v, want [%s]", fetcher.calls, feed.URL.Raw())
	}

	syncs := feeds.syncList()
	if len(syncs) != 1 {
		t.Fatalf("ApplySync calls = %d, want 1", len(syncs))
	}

	applied := syncs[0]
	if applied.feedID != "feed-1" {
		t.Fatalf("feedID = %q, want %q", applied.feedID, "feed-1")
	}

	if applied.title != "Fresh Title" {
		t.Fatalf("title = %q, want %q", applied.title, "Fresh Title")
	}

	if !applied.updatedAt.Equal(now) {
		t.Fatalf("updatedAt = %v, want %v", applied.updatedAt, now)
	}

	if len(applied.newItems) != 1 {
		t.Fatalf("newItems = %d, want 1 (retention honoured)", len(applied.newItems))
	}

	if applied.newItems[0].URL.Raw() != "https://example.com/one" {
		t.Fatalf("newItems[0].URL = %q, want https://example.com/one", applied.newItems[0].URL.Raw())
	}

	if applied.newItems[0].ID == "" {
		t.Fatal("newItems[0].ID = empty, want generated id")
	}

	if len(applied.deleteIDs) != 0 {
		t.Fatalf("deleteIDs = %v, want none", applied.deleteIDs)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures = %v, want none", failures)
	}
}

func TestRefreshOneFallsBackToFeedTitleAndHost(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		parsedTitle string
		feedTitle   string
		want        string
	}{
		{name: "parsed title wins", parsedTitle: "Parsed", feedTitle: "Stored", want: "Parsed"},
		{name: "stored feed title", parsedTitle: "   ", feedTitle: "Stored", want: "Stored"},
		{name: "url host", parsedTitle: "", feedTitle: "", want: "example.com"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml"), Title: tc.feedTitle}
			feeds := newTestFeedRepository(feed)

			queue := newTestRefreshQueue(t, RefreshConfig{
				Feeds:     feeds,
				FeedItems: &fakeFeedItemRepository{},
				Settings:  &fakeSettingRepository{},
				Fetcher:   &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"},
				Parser:    &fakeFeedParser{parsed: domain.ParsedFeed{Title: tc.parsedTitle}},
				Now:       func() time.Time { return now },
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); err != nil {
				t.Fatalf("RefreshOne() error = %v", err)
			}

			syncs := feeds.syncList()
			if len(syncs) != 1 {
				t.Fatalf("ApplySync calls = %d, want 1", len(syncs))
			}

			if syncs[0].title != tc.want {
				t.Fatalf("title = %q, want %q", syncs[0].title, tc.want)
			}
		})
	}
}

func TestRefreshOneRecordsFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		setup   func(fetcher *fakeFeedFetcher, parser *fakeFeedParser)
		summary string
	}{
		{
			name: "fetch failure is sanitized",
			setup: func(fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				fetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("fetch failed for https://alice:secret@example.com/feed.xml"))
			},
			summary: "FetchFeedError: fetch failed for https://example.com/feed.xml",
		},
		{
			name: "parse failure",
			setup: func(fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				parser.err = domain.NewError(domain.ErrFeedParserError, errors.New("invalid feed"))
			},
			summary: "FeedParserError: invalid feed",
		},
		{
			name: "parser panic is contained as a parse failure",
			setup: func(fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				parser.panics = true
			},
			summary: "FeedParserError: feed parser panicked",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
			feeds := newTestFeedRepository(feed)
			items := &fakeFeedItemRepository{}
			fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}
			parser := &fakeFeedParser{}
			tc.setup(fetcher, parser)

			queue := newTestRefreshQueue(t, RefreshConfig{
				Feeds:     feeds,
				FeedItems: items,
				Settings:  &fakeSettingRepository{},
				Fetcher:   fetcher,
				Parser:    parser,
				Now:       func() time.Time { return now },
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); err == nil {
				t.Fatal("RefreshOne() error = nil, want error")
			}

			failures := feeds.failureList()
			if len(failures) != 1 {
				t.Fatalf("recorded failures = %d, want 1", len(failures))
			}

			if failures[0].feedID != "feed-1" {
				t.Fatalf("failure feedID = %q, want feed-1", failures[0].feedID)
			}

			if failures[0].summary != tc.summary {
				t.Fatalf("failure summary = %q, want %q", failures[0].summary, tc.summary)
			}

			if strings.Contains(failures[0].summary, "alice:secret") {
				t.Fatalf("failure summary leaks credentials: %q", failures[0].summary)
			}

			if len(feeds.syncList()) != 0 {
				t.Fatal("ApplySync called after failure")
			}
		})
	}
}

func TestRefreshOneCanceledLookupRecordsNothing(t *testing.T) {
	t.Parallel()

	canceledFeeds := newTestFeedRepository()
	canceledFeeds.getErr = context.Canceled
	canceledQueue := newTestRefreshQueue(t, RefreshConfig{Feeds: canceledFeeds, Settings: &fakeSettingRepository{}})

	if err := canceledQueue.RefreshOne(context.Background(), "feed-1"); !errors.Is(err, context.Canceled) {
		t.Fatalf("RefreshOne(canceled) error = %v, want context.Canceled", err)
	}

	if failures := canceledFeeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures on canceled lookup = %+v, want none", failures)
	}
}

func TestRefreshOneDatabaseErrorsDoNotIncrementFailureCountAndLog(t *testing.T) {
	cases := []struct {
		name     string
		want     error
		settings *fakeSettingRepository
		setup    func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, want error)
	}{
		{
			name: "get by id failure",
			want: domain.NewError(domain.ErrFeedRepositoryError, errors.New("get failed for https://alice:secret@example.com/db")),
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, want error) {
				feeds.getErr = want
			},
		},
		{
			name:     "settings failure aborts before fetching",
			want:     domain.NewError(domain.ErrSettingRepositoryError, errors.New("settings failed for https://alice:secret@example.com/db")),
			settings: &fakeSettingRepository{},
			setup:    nil,
		},
		{
			name: "list stored refs failure",
			want: domain.NewError(domain.ErrFeedItemRepositoryError, errors.New("items failed for https://alice:secret@example.com/db")),
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, want error) {
				items.listErr = want
			},
		},
		{
			name: "apply sync failure",
			want: domain.NewError(domain.ErrFeedRepositoryError, errors.New("apply sync failed for https://alice:secret@example.com/db")),
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, want error) {
				feeds.applyErr = want
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			var logMu sync.Mutex
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&lockedWriter{mu: &logMu, buf: &buf}, nil)))
			t.Cleanup(func() {
				slog.SetDefault(prev)
			})

			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
			feeds := newTestFeedRepository(feed)
			items := &fakeFeedItemRepository{}
			fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}
			parser := &fakeFeedParser{}
			settings := tc.settings
			if settings == nil {
				settings = &fakeSettingRepository{}
			} else {
				settings.getErr = tc.want
			}

			if tc.setup != nil {
				tc.setup(feeds, items, tc.want)
			}

			queue := newTestRefreshQueue(t, RefreshConfig{
				Feeds:     feeds,
				FeedItems: items,
				Settings:  settings,
				Fetcher:   fetcher,
				Parser:    parser,
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); !errors.Is(err, tc.want) {
				t.Fatalf("RefreshOne() error = %v, want %v", err, tc.want)
			}

			if failures := feeds.failureList(); len(failures) != 0 {
				t.Fatalf("recorded failures = %+v, want none", failures)
			}

			if len(feeds.syncList()) != 0 {
				t.Fatal("ApplySync recorded after failure")
			}

			if tc.settings != nil && fetcher.callCount() != 0 {
				t.Fatalf("feed fetched %d times after settings DB failure, want 0", fetcher.callCount())
			}

			logMu.Lock()
			out := buf.String()
			logMu.Unlock()

			if !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "feed refresh failed") {
				t.Fatalf("expected ERROR log for DB failure, got:\n%s", out)
			}

			if strings.Contains(out, "alice:secret") {
				t.Fatalf("log leaked credentials:\n%s", out)
			}
		})
	}
}

func TestRefreshOneDeletedFeedRecordsNothing(t *testing.T) {
	t.Parallel()

	feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
	feeds := newTestFeedRepository(feed)
	if err := feeds.Delete(context.Background(), feed.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	fetcher := &fakeFeedFetcher{}
	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   fetcher,
		Parser:    &fakeFeedParser{},
	})

	if err := queue.RefreshOne(context.Background(), feed.ID); err != nil {
		t.Fatalf("RefreshOne() error = %v, want nil", err)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures = %+v, want none for deleted feed", failures)
	}

	if len(feeds.syncList()) != 0 {
		t.Fatal("ApplySync called for deleted feed")
	}

	if fetcher.callCount() != 0 {
		t.Fatalf("fetcher calls = %d, want 0 for deleted feed", fetcher.callCount())
	}
}

func TestEnqueueDeduplicatesPendingFeeds(t *testing.T) {
	t.Parallel()
	feeds := newTestFeedRepository(
		domain.Feed{ID: "a", URL: testURL(t, "https://example.com/a")},
		domain.Feed{ID: "b", URL: testURL(t, "https://example.com/b")},
		domain.Feed{ID: "c", URL: testURL(t, "https://example.com/c")},
	)
	// Start with no startup feeds so the enqueue operation must wake a worker.
	feeds.list = nil
	lookedUp := make(chan string, 10)
	synced := make(chan string, 3)
	feeds.onGet = func(id string) { lookedUp <- id }
	feeds.onSync = func(id string) { synced <- id }
	queue := newTestRefreshQueue(t, RefreshConfig{Feeds: feeds, FeedItems: &fakeFeedItemRepository{}, Settings: &fakeSettingRepository{}, Fetcher: &fakeFeedFetcher{}, Parser: &fakeFeedParser{}, Interval: time.Hour})
	queue.Enqueue("a", "a", "b")
	queue.Enqueue("a", "b")
	ctx, cancel := context.WithCancel(context.Background())
	queue.Start(ctx)
	for range 2 {
		select {
		case <-synced:
		case <-time.After(testWaitTimeout):
			cancel()
			queue.Wait()
			t.Fatal("workers did not process pending feeds")
		}
	}
	queue.Enqueue("c")
	select {
	case <-synced:
	case <-time.After(testWaitTimeout):
		cancel()
		queue.Wait()
		t.Fatal("worker did not process the later enqueue")
	}
	cancel()
	queue.Wait()
	close(lookedUp)
	var got []string
	for id := range lookedUp {
		got = append(got, id)
	}
	slices.Sort(got)
	if !slices.Equal(got, []string{"a", "b", "c"}) {
		t.Fatalf("looked up IDs = %v, want [a b c]", got)
	}
}

func TestEnqueueAllReturnsListError(t *testing.T) {
	t.Parallel()

	want := errors.New("list failed")
	feeds := newTestFeedRepository()
	feeds.listErr = want

	queue := newTestRefreshQueue(t, RefreshConfig{Feeds: feeds})

	if err := queue.EnqueueAll(context.Background()); !errors.Is(err, want) {
		t.Fatalf("EnqueueAll() error = %v, want %v", err, want)
	}
}

func TestStartRefreshesAllFeedsAtStartup(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name                 string
		interval             time.Duration
		feedCount, wantSyncs int
	}{
		{"startup", time.Hour, 2, 2},
		{"periodic", 20 * time.Millisecond, 1, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			entries := []domain.Feed{{ID: "feed-1", URL: testURL(t, "https://example.com/one.xml")}, {ID: "feed-2", URL: testURL(t, "https://example.com/two.xml")}}
			feeds := newTestFeedRepository(entries[:tc.feedCount]...)
			synced := make(chan string, 100)
			feeds.onSync = func(id string) { synced <- id }
			queue := newTestRefreshQueue(t, RefreshConfig{Feeds: feeds, FeedItems: &fakeFeedItemRepository{}, Settings: &fakeSettingRepository{}, Fetcher: &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}, Parser: &fakeFeedParser{}, Interval: tc.interval, Now: func() time.Time { return now }})
			ctx, cancel := context.WithCancel(context.Background())
			queue.Start(ctx)
			for range tc.wantSyncs {
				select {
				case <-synced:
				case <-time.After(testWaitTimeout):
					cancel()
					queue.Wait()
					t.Fatal("refresh did not complete")
				}
			}
			cancel()
			queue.Wait()
			syncs := feeds.syncList()
			if len(syncs) < tc.wantSyncs {
				t.Fatalf("ApplySync calls = %d, want at least %d", len(syncs), tc.wantSyncs)
			}
			if tc.name == "startup" {
				ids := []string{syncs[0].feedID, syncs[1].feedID}
				slices.Sort(ids)
				if !slices.Equal(ids, []string{"feed-1", "feed-2"}) {
					t.Fatalf("synced IDs = %v", ids)
				}
			}
		})
	}
}

func TestStartBoundsConcurrency(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feeds := make([]domain.Feed, 0, 6)
	for i := range 6 {
		id := string(rune('a' + i))
		feeds = append(feeds, domain.Feed{ID: id, URL: testURL(t, "https://example.com/"+id+".xml")})
	}

	release := make(chan struct{})
	entered := make(chan struct{}, len(feeds))

	var mu sync.Mutex
	active, maxActive := 0, 0

	fetcher := &fakeFeedFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}

		mu.Unlock()

		entered <- struct{}{}
		<-release

		mu.Lock()
		active--
		mu.Unlock()

		return []byte("x"), "https://example.com/feed", nil
	}

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:       newTestFeedRepository(feeds...),
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{},
		Fetcher:     fetcher,
		Parser:      &fakeFeedParser{},
		Concurrency: 2,
		Interval:    time.Hour,
		Now:         func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	for range 2 {
		select {
		case <-entered:
		case <-time.After(testWaitTimeout):
			t.Fatal("timed out waiting for concurrent workers")
		}
	}

	mu.Lock()
	gotMax := maxActive
	mu.Unlock()

	if gotMax != 2 {
		t.Fatalf("max concurrent refreshes = %d, want 2", gotMax)
	}

	close(release)

	waitFor(t, func() bool { return fetcher.callCount() >= len(feeds) }, "all feeds refreshed")

	mu.Lock()
	defer mu.Unlock()

	if maxActive > 2 {
		t.Fatalf("max concurrent refreshes = %d, want <= 2", maxActive)
	}
}

func TestEnqueueDropsRunningFeed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feed1 := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
	feed2 := domain.Feed{ID: "feed-2", URL: testURL(t, "https://example.com/2.xml")}
	feeds := newTestFeedRepository(feed1, feed2)
	feeds.list = []domain.Feed{feed1}

	release := make(chan struct{})
	started := make(chan struct{}, 1)

	fetcher := &fakeFeedFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		if url == feed1.URL && fetcher.callCount() == 1 {
			started <- struct{}{}
			<-release
		}

		return []byte("x"), url.Raw(), nil
	}

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:       feeds,
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{},
		Fetcher:     fetcher,
		Parser:      &fakeFeedParser{},
		Concurrency: 1,
		Interval:    time.Hour,
		Now:         func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for first refresh to start")
	}

	// Enqueue duplicate feed-1 followed by feed-2 while feed-1 is running;
	// concurrency-1 FIFO order proves duplicate feed-1 was dropped.
	queue.Enqueue("feed-1")
	queue.Enqueue("feed-2")

	close(release)

	waitFor(t, func() bool { return fetcher.callCount() == 2 }, "feed-2 processed after feed-1")

	fetcher.mu.Lock()
	calls := append([]string(nil), fetcher.calls...)
	fetcher.mu.Unlock()
	if !slices.Equal(calls, []string{feed1.URL.Raw(), feed2.URL.Raw()}) {
		t.Fatalf("fetch calls = %v, want [%s %s]", calls, feed1.URL.Raw(), feed2.URL.Raw())
	}

	queue.Enqueue("feed-1")

	waitFor(t, func() bool { return fetcher.callCount() == 3 }, "re-enqueue after completion")

	cancel()
	queue.Wait()
}

func TestRefreshQueueWaitStopsDequeuingOnCancel(t *testing.T) {
	t.Parallel()

	feeds := newTestFeedRepository(
		domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/1.xml")},
		domain.Feed{ID: "feed-2", URL: testURL(t, "https://example.com/2.xml")},
		domain.Feed{ID: "feed-3", URL: testURL(t, "https://example.com/3.xml")},
	)

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	fetcher := &fakeFeedFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		started <- struct{}{}
		<-release

		return nil, "", ctx.Err()
	}

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:       feeds,
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{},
		Fetcher:     fetcher,
		Parser:      &fakeFeedParser{},
		Concurrency: 1,
		Interval:    time.Hour,
	})

	ctx, cancel := context.WithCancel(context.Background())
	queue.Start(ctx)

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for first worker to start")
	}

	cancel()
	close(release)

	done := make(chan struct{})
	go func() {
		queue.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for RefreshQueue.Wait()")
	}

	if got := fetcher.callCount(); got != 1 {
		t.Fatalf("fetch calls after cancel = %d, want 1 (pending feeds should not be drained)", got)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("failures recorded for cancelled pending feeds = %v, want none", failures)
	}
}

func TestRefreshQueueSurfacesErrorsWithoutSecrets(t *testing.T) {
	var buf bytes.Buffer
	var logMu sync.Mutex
	handler := slog.NewTextHandler(&lockedWriter{mu: &logMu, buf: &buf}, nil)
	prev := slog.Default()
	slog.SetDefault(slog.New(handler))
	t.Cleanup(func() {
		slog.SetDefault(prev)
	})

	feeds := newTestFeedRepository(domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/1.xml")})
	feeds.listErr = errors.New("list failed for https://alice:secret@example.com/list " + strings.Repeat("x", 600))
	feeds.recordErr = errors.New("record failed for https://bob:pw@example.com/rec")

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   &fakeFeedFetcher{err: errors.New("fetch failed")},
		Parser:    &fakeFeedParser{},
		Interval:  10 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	queue.Start(ctx)

	waitFor(t, func() bool {
		logMu.Lock()
		defer logMu.Unlock()
		out := buf.String()

		return strings.Contains(out, "initial feed refresh enqueue failed") &&
			strings.Contains(out, "scheduled feed refresh enqueue failed")
	}, "startup and scheduled enqueue errors logged")

	cancel()
	queue.Wait()

	if err := queue.RefreshOne(context.Background(), "feed-1"); err == nil {
		t.Fatal("RefreshOne() error = nil, want fetch error")
	}

	logMu.Lock()
	out := buf.String()
	logMu.Unlock()

	if !strings.Contains(out, "record feed refresh failure failed") {
		t.Fatalf("expected recordFailure error to be logged, got:\n%s", out)
	}

	for _, secret := range []string{"alice:secret", "bob:pw"} {
		if strings.Contains(out, secret) {
			t.Fatalf("logs leaked secret %q:\n%s", secret, out)
		}
	}

	if !strings.Contains(out, "...") {
		t.Fatalf("expected oversized log error to be truncated:\n%s", out)
	}
}

func TestRefreshQueueFatalAfterThreeConsecutiveDatabaseFailuresAndResets(t *testing.T) {
	t.Parallel()

	feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
	feeds := newTestFeedRepository(feed)
	items := &fakeFeedItemRepository{}
	settings := &fakeSettingRepository{}
	fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}
	parser := &fakeFeedParser{}

	var fatals fatalRecorder

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: items,
		Settings:  settings,
		Fetcher:   fetcher,
		Parser:    parser,
		OnFatal:   fatals.Record,
	})

	dbErr1 := domain.NewError(domain.ErrFeedRepositoryError, errors.New("list failed"))
	dbErr2 := domain.NewError(domain.ErrSettingRepositoryError, errors.New("settings failed"))
	dbErr3 := domain.NewError(domain.ErrFeedRepositoryError, errors.New("apply failed for https://alice:secret@example.com/db"))

	// Two DB failures followed by a successful ApplySync reset the streak.
	feeds.listErr = dbErr1
	if err := queue.EnqueueAll(context.Background()); !errors.Is(err, dbErr1) {
		t.Fatalf("EnqueueAll() error = %v, want %v", err, dbErr1)
	}

	feeds.listErr = nil
	settings.getErr = dbErr2
	if err := queue.RefreshOne(context.Background(), feed.ID); !errors.Is(err, dbErr2) {
		t.Fatalf("RefreshOne() error = %v, want %v", err, dbErr2)
	}

	if got := fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls = %d, want 0 before threshold", got)
	}

	settings.getErr = nil
	if err := queue.RefreshOne(context.Background(), feed.ID); err != nil {
		t.Fatalf("RefreshOne(success) error = %v", err)
	}

	// Two DB failures followed by a successful EnqueueAll also reset the streak.
	items.listErr = dbErr2
	_ = queue.RefreshOne(context.Background(), feed.ID)
	items.listErr = nil
	feeds.applyErr = dbErr3
	_ = queue.RefreshOne(context.Background(), feed.ID)

	if err := queue.EnqueueAll(context.Background()); err != nil {
		t.Fatalf("EnqueueAll(success) error = %v", err)
	}

	// A successful RecordRefreshFailure write proves the database works and resets the streak:
	// EnqueueAll DB failure, reset by the recorded external failure, then RecordRefreshFailure,
	// ApplySync and ApplySync DB failures reach the threshold => 1 fatal.
	feeds.applyErr = nil
	feeds.listErr = dbErr1
	_ = queue.EnqueueAll(context.Background())

	feeds.listErr = nil
	fetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("upstream 503"))
	_ = queue.RefreshOne(context.Background(), feed.ID)
	if len(feeds.failureList()) != 1 {
		t.Fatalf("failures = %d, want 1 from external fetch error", len(feeds.failureList()))
	}

	feeds.recordErr = dbErr2
	_ = queue.RefreshOne(context.Background(), feed.ID)

	fetcher.err = nil
	feeds.recordErr = nil
	feeds.applyErr = dbErr3
	_ = queue.RefreshOne(context.Background(), feed.ID)

	_ = queue.RefreshOne(context.Background(), feed.ID)

	// 4th consecutive DB failure does not trigger OnFatal a second time.
	_ = queue.RefreshOne(context.Background(), feed.ID)

	gotFatal := fatals.Errors()
	if len(gotFatal) != 1 {
		t.Fatalf("OnFatal calls = %d, want 1", len(gotFatal))
	}

	if !errors.Is(gotFatal[0], dbErr3) {
		t.Fatalf("fatal error = %v, want wrapping %v", gotFatal[0], dbErr3)
	}

	if strings.Contains(gotFatal[0].Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", gotFatal[0].Error())
	}
}

func TestRefreshQueueExternalErrorsNeverTriggerFatal(t *testing.T) {
	t.Parallel()

	feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
	feeds := newTestFeedRepository(feed)
	fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}
	parser := &fakeFeedParser{}

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   fetcher,
		Parser:    parser,
	})

	for i := range 10 {
		if i%2 == 0 {
			fetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("upstream 502"))
			parser.err = nil
		} else {
			fetcher.err = nil
			parser.err = domain.NewError(domain.ErrFeedParserError, errors.New("malformed xml"))
		}

		if err := queue.RefreshOne(context.Background(), feed.ID); err == nil {
			t.Fatalf("RefreshOne() #%d error = nil, want external error", i+1)
		}
	}

	if got := len(feeds.failureList()); got != 10 {
		t.Fatalf("recorded failures = %d, want 10", got)
	}
}

func TestRefreshQueueCanceledContextNeverFatal(t *testing.T) {
	t.Parallel()

	feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
	feeds := newTestFeedRepository(feed)
	feeds.listErr = domain.NewError(domain.ErrFeedRepositoryError, context.Canceled)
	feeds.getErr = domain.NewError(domain.ErrFeedRepositoryError, errors.New("driver closing"))

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	for range 5 {
		_ = queue.EnqueueAll(ctx)
		_ = queue.RefreshOne(ctx, feed.ID)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures = %+v, want none when canceled", failures)
	}
}

func TestRefreshQueueWorkerPoolConcurrentDatabaseFailuresFatalOnce(t *testing.T) {
	t.Parallel()

	feeds := newTestFeedRepository(
		domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/1.xml")},
		domain.Feed{ID: "feed-2", URL: testURL(t, "https://example.com/2.xml")},
		domain.Feed{ID: "feed-3", URL: testURL(t, "https://example.com/3.xml")},
		domain.Feed{ID: "feed-4", URL: testURL(t, "https://example.com/4.xml")},
		domain.Feed{ID: "feed-5", URL: testURL(t, "https://example.com/5.xml")},
	)
	dbErr := domain.NewError(domain.ErrSettingRepositoryError, errors.New("db locked"))

	var fatals fatalRecorder

	queue := newTestRefreshQueue(t, RefreshConfig{
		Feeds:       feeds,
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{getErr: dbErr},
		Fetcher:     &fakeFeedFetcher{},
		Parser:      &fakeFeedParser{},
		Concurrency: 5,
		Interval:    time.Hour,
		OnFatal:     fatals.Record,
	})

	ctx, cancel := context.WithCancel(context.Background())
	queue.Start(ctx)

	waitFor(t, func() bool {
		return fatals.Count() >= 1
	}, "OnFatal after 3 worker DB failures")

	cancel()
	queue.Wait()

	gotFatal := fatals.Errors()

	if len(gotFatal) != 1 {
		t.Fatalf("OnFatal calls = %d, want 1", len(gotFatal))
	}

	if !errors.Is(gotFatal[0], dbErr) {
		t.Fatalf("fatal error = %v, want wrapping %v", gotFatal[0], dbErr)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures = %+v, want none", failures)
	}
}
