package worker

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reader/internal/domain"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

var refreshTestNow = time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)

type refreshFixture struct {
	feeds   *fakeFeedRepository
	fetcher *fakeFeedFetcher
	parser  *fakeFeedParser
	fatals  fatalRecorder
	cfg     RefreshConfig
}

// newRefreshFixture wires fakes where the given feeds are due. The poll
// interval is an hour so wakes stay explicit; tests that need ticks shorten it.
func newRefreshFixture(due ...domain.Feed) *refreshFixture {
	fx := &refreshFixture{
		feeds:   newTestFeedRepository(due...),
		fetcher: &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"},
		parser:  &fakeFeedParser{},
	}

	fx.cfg = RefreshConfig{
		Feeds:        fx.feeds,
		Fetcher:      fx.fetcher,
		Parser:       fx.parser,
		PollInterval: time.Hour,
		Now:          func() time.Time { return refreshTestNow },
	}

	return fx
}

// start runs the queue until stop is called or the test ends; stop cancels the
// queue and waits for its goroutines.
func (fx *refreshFixture) start(t *testing.T) (queue *RefreshQueue, stop func()) {
	t.Helper()

	queue = newTestRefreshQueue(t, fx.cfg)
	queue.releaseBaseBackoff = time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	stop = func() {
		cancel()
		queue.Wait()
	}

	t.Cleanup(stop)
	queue.Start(ctx)

	return queue, stop
}

func testRefreshFeed(t *testing.T, id string) domain.Feed {
	t.Helper()

	return domain.Feed{ID: id, URL: testURL(t, "https://example.com/"+id+".xml")}
}

func (fx *refreshFixture) recordedCount() int {
	return len(fx.feeds.succeededList()) + len(fx.feeds.failedList())
}

// captureLogs routes the default logger into a buffer for the test and returns
// a reader of what was logged.
func captureLogs(t *testing.T) func() string {
	t.Helper()

	var (
		mu  sync.Mutex
		buf bytes.Buffer
	)

	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&lockedWriter{mu: &mu, buf: &buf}, nil)))
	t.Cleanup(func() {
		slog.SetDefault(prev)
	})

	return func() string {
		mu.Lock()
		defer mu.Unlock()

		return buf.String()
	}
}

func TestRefreshSyncsDueFeed(t *testing.T) {
	t.Parallel()

	finishedAt := refreshTestNow.Add(7 * time.Second)
	feed := testRefreshFeed(t, "feed-1")
	feed.Title = "Old Title"

	fx := newRefreshFixture(feed)
	fx.cfg.Now = sequenceClock(refreshTestNow, finishedAt)
	entries := []domain.ParsedFeedEntry{
		parsedEntry(t, "https://example.com/one", "One"),
		parsedEntry(t, "https://example.com/two", "Two"),
	}
	fx.parser.parsed = domain.ParsedFeed{
		Title:   "Fresh Title",
		SiteURL: ptrTo("https://example.com/"),
		IconURL: ptrTo("https://example.com/icon.png"),
		Entries: slices.Clone(entries),
	}

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.recordedCount() == 1 }, "feed refreshed")
	stop()

	claims := fx.feeds.claimList()
	if len(claims) != 1 || claims[0].feedID != "feed-1" || !claims[0].now.Equal(refreshTestNow) {
		t.Fatalf("claims = %+v, want one claim of feed-1 at %v", claims, refreshTestNow)
	}

	if !slices.Equal(fx.fetcher.calls, []string{feed.URL.Raw()}) {
		t.Fatalf("fetched URLs = %v, want [%s]", fx.fetcher.calls, feed.URL.Raw())
	}

	succeeded := fx.feeds.succeededList()
	if len(succeeded) != 1 {
		t.Fatalf("SucceedRefresh calls = %d, want 1", len(succeeded))
	}

	assertSucceededRefresh(t, succeeded[0], claims[0].attemptID, finishedAt, entries)

	if failed, released := fx.feeds.failedList(), fx.feeds.releasedList(); len(failed) != 0 || len(released) != 0 {
		t.Fatalf("failed = %v, released = %v, want none", failed, released)
	}
}

func assertSucceededRefresh(t *testing.T, got succeededRefresh, attemptID string, finishedAt time.Time, entries []domain.ParsedFeedEntry) {
	t.Helper()

	if got.attemptID != attemptID || got.feedID != "feed-1" {
		t.Fatalf("succeeded attempt/feed = %q/%q, want %q/feed-1", got.attemptID, got.feedID, attemptID)
	}

	wantMeta := domain.FeedSyncMeta{
		Title:   "Fresh Title",
		SiteURL: ptrTo("https://example.com/"),
		IconURL: ptrTo("https://example.com/icon.png"),
	}
	if !reflect.DeepEqual(got.meta, wantMeta) {
		t.Fatalf("meta = %+v, want %+v", got.meta, wantMeta)
	}

	if !reflect.DeepEqual(got.entries, entries) {
		t.Fatalf("entries = %+v, want %+v in source order", got.entries, entries)
	}

	wantNext := finishedAt.Add(30 * time.Minute)
	if !got.finishedAt.Equal(finishedAt) || !got.nextRefreshAt.Equal(wantNext) {
		t.Fatalf("finished/next = %v/%v, want %v/%v", got.finishedAt, got.nextRefreshAt, finishedAt, wantNext)
	}
}

func TestRefreshFallsBackToFeedTitleAndHost(t *testing.T) {
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

			feed := testRefreshFeed(t, "feed-1")
			feed.Title = tc.feedTitle

			fx := newRefreshFixture(feed)
			fx.parser.parsed = domain.ParsedFeed{Title: tc.parsedTitle}
			_, stop := fx.start(t)

			waitFor(t, func() bool { return fx.recordedCount() == 1 }, "feed refreshed")
			stop()

			succeeded := fx.feeds.succeededList()
			if len(succeeded) != 1 || succeeded[0].meta.Title != tc.want {
				t.Fatalf("succeeded = %+v, want one refresh titled %q", succeeded, tc.want)
			}
		})
	}
}

func TestRefreshRecordsExternalFailures(t *testing.T) {
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

			finishedAt := refreshTestNow.Add(3 * time.Second)

			fx := newRefreshFixture(testRefreshFeed(t, "feed-1"))
			fx.cfg.Now = sequenceClock(refreshTestNow, finishedAt)
			tc.setup(fx.fetcher, fx.parser)

			_, stop := fx.start(t)

			waitFor(t, func() bool { return fx.recordedCount() == 1 }, "failure recorded")
			stop()

			claims := fx.feeds.claimList()
			failed := fx.feeds.failedList()

			if len(claims) != 1 || len(failed) != 1 {
				t.Fatalf("claims = %d, failed = %d, want 1 and 1", len(claims), len(failed))
			}

			want := failedRefresh{
				attemptID:     claims[0].attemptID,
				feedID:        "feed-1",
				summary:       tc.summary,
				finishedAt:    finishedAt,
				nextRefreshAt: finishedAt.Add(30 * time.Minute),
			}
			if failed[0] != want {
				t.Fatalf("FailRefresh = %+v, want %+v", failed[0], want)
			}

			if len(fx.feeds.succeededList()) != 0 || len(fx.feeds.releasedList()) != 0 {
				t.Fatal("external failure must not succeed or release the attempt")
			}
		})
	}
}

func TestRefreshExternalFailuresNeverFatal(t *testing.T) {
	t.Parallel()

	feed := testRefreshFeed(t, "feed-1")
	fx := newRefreshFixture()
	fx.fetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("upstream 502"))

	queue, stop := fx.start(t)

	for i := range 10 {
		fx.feeds.makeDue(feed)
		queue.Wake()

		waitFor(t, func() bool { return len(fx.feeds.failedList()) == i+1 }, "failure recorded")
	}

	stop()

	if released := fx.feeds.releasedList(); len(released) != 0 {
		t.Fatalf("released = %v, want none for external failures", released)
	}
}

func TestRefreshDrainsMoreDueFeedsThanWorkers(t *testing.T) {
	t.Parallel()

	ids := []string{"a", "b", "c", "d", "e", "f"}
	feeds := make([]domain.Feed, 0, len(ids))

	for _, id := range ids {
		feeds = append(feeds, testRefreshFeed(t, id))
	}

	fx := newRefreshFixture(feeds...)
	fx.cfg.Concurrency = 2

	release := make(chan struct{})
	entered := make(chan struct{}, len(feeds))

	var (
		mu                sync.Mutex
		active, maxActive int
	)

	fx.fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		mu.Lock()
		active++
		maxActive = max(maxActive, active)
		mu.Unlock()

		entered <- struct{}{}

		select {
		case <-release:
		case <-ctx.Done():
		}

		mu.Lock()
		active--
		mu.Unlock()

		return []byte("x"), url.Raw(), nil
	}

	_, stop := fx.start(t)

	// Start wakes the pool once; the second worker only claims because the
	// first claim signals it.
	for range 2 {
		select {
		case <-entered:
		case <-time.After(testWaitTimeout):
			t.Fatal("timed out waiting for two concurrent refreshes")
		}
	}

	close(release)
	waitFor(t, func() bool { return len(fx.feeds.succeededList()) == len(feeds) }, "all due feeds refreshed")
	stop()

	var got []string
	for _, refresh := range fx.feeds.succeededList() {
		got = append(got, refresh.feedID)
	}

	slices.Sort(got)

	if !slices.Equal(got, ids) {
		t.Fatalf("refreshed feeds = %v, want each of %v once", got, ids)
	}

	if maxActive != 2 {
		t.Fatalf("max concurrent refreshes = %d, want 2", maxActive)
	}
}

func TestWakeClaimsNewlyDueFeed(t *testing.T) {
	t.Parallel()

	feed := testRefreshFeed(t, "feed-1")
	fx := newRefreshFixture()
	queue, stop := fx.start(t)

	// The startup pass finds nothing and the tick is an hour away, so only Wake
	// can surface the feed.
	waitFor(t, func() bool { return fx.feeds.claimCallCount() >= 1 }, "startup claim pass")
	fx.feeds.makeDue(feed)
	queue.Wake()

	waitFor(t, func() bool { return len(fx.feeds.succeededList()) == 1 }, "woken refresh")
	stop()

	if claims := fx.feeds.claimList(); len(claims) != 1 || claims[0].feedID != feed.ID {
		t.Fatalf("claims = %+v, want one claim of %s", claims, feed.ID)
	}
}

func TestSchedulerTickClaimsNewlyDueFeed(t *testing.T) {
	t.Parallel()

	feed := testRefreshFeed(t, "feed-1")
	fx := newRefreshFixture()
	fx.cfg.PollInterval = 5 * time.Millisecond
	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.feeds.claimCallCount() >= 1 }, "startup claim pass")
	fx.feeds.makeDue(feed)

	waitFor(t, func() bool { return len(fx.feeds.succeededList()) == 1 }, "refresh on tick")
	stop()
}

func TestRefreshReleasesClaimOnDatabaseErrorAndRetriesWithoutRestart(t *testing.T) {
	cases := []struct {
		name       string
		inject     func(fx *refreshFixture, err error)
		wantFailed bool
	}{
		{
			name: "succeed write",
			inject: func(fx *refreshFixture, err error) {
				fx.feeds.succeedScript.steps = []error{err}
			},
		},
		{
			name: "fail write",
			inject: func(fx *refreshFixture, err error) {
				fx.fetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("upstream 502"))
				fx.feeds.failScript.steps = []error{err}
			},
			wantFailed: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLogs(t)
			dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("db failed for https://alice:secret@example.com/db"))

			fx := newRefreshFixture(testRefreshFeed(t, "feed-1"))
			fx.cfg.PollInterval = 5 * time.Millisecond
			tc.inject(fx, dbErr)

			_, stop := fx.start(t)

			waitFor(t, func() bool { return fx.recordedCount() == 1 }, "refresh recorded after the release")
			stop()

			assertReleasedThenRecorded(t, fx, tc.wantFailed)

			out := logs()
			if !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "feed refresh failed") {
				t.Fatalf("expected ERROR log for DB failure, got:\n%s", out)
			}

			if strings.Contains(out, "alice:secret") {
				t.Fatalf("log leaked credentials:\n%s", out)
			}
		})
	}
}

// assertReleasedThenRecorded checks that the first attempt was released
// without any write and that a second attempt of the same feed recorded the
// outcome.
func assertReleasedThenRecorded(t *testing.T, fx *refreshFixture, wantFailed bool) {
	t.Helper()

	claims := fx.feeds.claimList()
	if len(claims) != 2 || claims[0].attemptID == claims[1].attemptID || claims[0].feedID != claims[1].feedID {
		t.Fatalf("claims = %+v, want two attempts of the same feed", claims)
	}

	released := fx.feeds.releasedList()
	if want := (releasedRefresh{attemptID: claims[0].attemptID, feedID: "feed-1"}); len(released) != 1 || released[0] != want {
		t.Fatalf("released = %+v, want [%+v]", released, want)
	}

	var recorded []string
	for _, refresh := range fx.feeds.succeededList() {
		recorded = append(recorded, refresh.attemptID)
	}

	for _, refresh := range fx.feeds.failedList() {
		recorded = append(recorded, refresh.attemptID)
	}

	if !slices.Equal(recorded, []string{claims[1].attemptID}) {
		t.Fatalf("recorded attempts = %v, want only the second attempt %s", recorded, claims[1].attemptID)
	}

	if gotFailed := len(fx.feeds.failedList()) == 1; gotFailed != wantFailed {
		t.Fatalf("failure recorded = %t, want %t", gotFailed, wantFailed)
	}
}

func TestRefreshReleaseRetriesUntilItSucceeds(t *testing.T) {
	t.Parallel()

	releaseErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("release failed"))
	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("succeed refresh failed"))

	fx := newRefreshFixture(testRefreshFeed(t, "feed-1"))
	fx.cfg.PollInterval = 5 * time.Millisecond
	fx.feeds.succeedScript.steps = []error{dbErr}
	fx.feeds.releaseScript.steps = []error{releaseErr, releaseErr}

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.recordedCount() == 1 }, "refresh recorded after the release")
	stop()

	if got := fx.feeds.releaseScript.calls; got != releaseMaxAttempts {
		t.Fatalf("ReleaseRefresh calls = %d, want %d", got, releaseMaxAttempts)
	}

	if released := fx.feeds.releasedList(); len(released) != 1 {
		t.Fatalf("released = %+v, want exactly one successful release", released)
	}
}

func TestRefreshFatalWhenReleaseKeepsFailing(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("succeed refresh failed"))
	releaseErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("release failed for https://alice:secret@example.com/db"))

	fx := newRefreshFixture(testRefreshFeed(t, "feed-1"))
	fx.cfg.OnFatal = fx.fatals.Record
	fx.feeds.succeedScript.after = dbErr
	fx.feeds.releaseScript.after = releaseErr

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.fatals.Count() >= 1 }, "OnFatal after the release budget is exhausted")
	stop()

	fatals := fx.fatals.Errors()
	if len(fatals) != 1 || !errors.Is(fatals[0], releaseErr) {
		t.Fatalf("fatals = %v, want one wrapping %v", fatals, releaseErr)
	}

	if strings.Contains(fatals[0].Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", fatals[0].Error())
	}

	if got := fx.feeds.releaseScript.calls; got != releaseMaxAttempts {
		t.Fatalf("ReleaseRefresh calls = %d, want %d", got, releaseMaxAttempts)
	}

	if fx.recordedCount() != 0 || len(fx.feeds.releasedList()) != 0 {
		t.Fatal("nothing may be recorded or released when the release keeps failing")
	}
}

func TestRefreshShutdownDuringFetchWritesNothing(t *testing.T) {
	t.Parallel()

	fx := newRefreshFixture(testRefreshFeed(t, "feed-1"), testRefreshFeed(t, "feed-2"), testRefreshFeed(t, "feed-3"))
	fx.cfg.Concurrency = 1

	entered := make(chan struct{}, 1)
	fx.fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		entered <- struct{}{}

		<-ctx.Done()

		return nil, "", ctx.Err()
	}

	_, stop := fx.start(t)

	select {
	case <-entered:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for the refresh to start")
	}

	stop()

	if fx.recordedCount() != 0 || len(fx.feeds.releasedList()) != 0 {
		t.Fatalf("succeeded = %v, failed = %v, released = %v, want no writes on shutdown",
			fx.feeds.succeededList(), fx.feeds.failedList(), fx.feeds.releasedList())
	}

	if claims := fx.feeds.claimList(); len(claims) != 1 {
		t.Fatalf("claims = %+v, want 1 (pending feeds must not be claimed after shutdown)", claims)
	}

	if got := fx.fetcher.callCount(); got != 1 {
		t.Fatalf("fetch calls = %d, want 1", got)
	}
}

func TestRefreshClaimFailuresAreFatalAfterThreeConsecutive(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("claim failed for https://alice:secret@example.com/db"))

	fx := newRefreshFixture()
	fx.cfg.Concurrency = 1
	fx.cfg.PollInterval = 2 * time.Millisecond
	fx.cfg.OnFatal = fx.fatals.Record
	fx.feeds.claimScript.after = dbErr

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.fatals.Count() >= 1 }, "OnFatal after consecutive claim failures")
	stop()

	fatals := fx.fatals.Errors()
	if len(fatals) != 1 || !errors.Is(fatals[0], dbErr) {
		t.Fatalf("fatals = %v, want exactly one wrapping %v", fatals, dbErr)
	}

	if strings.Contains(fatals[0].Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", fatals[0].Error())
	}
}

func TestRefreshEmptyClaimResetsFailureStreak(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("claim failed"))

	fx := newRefreshFixture()
	fx.cfg.Concurrency = 1
	fx.cfg.PollInterval = 2 * time.Millisecond
	fx.feeds.claimScript.steps = []error{dbErr, dbErr, nil, dbErr, dbErr}

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.feeds.claimCallCount() >= 7 }, "claims past the scripted failures")
	stop()

	if got := fx.fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls = %d, want 0 (a successful claim resets the streak)", got)
	}
}

func TestRefreshDatabaseFailuresDuringRefreshAreFatalAfterThreeConsecutive(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("succeed refresh failed for https://alice:secret@example.com/db"))

	fx := newRefreshFixture(testRefreshFeed(t, "feed-1"))
	fx.cfg.PollInterval = 2 * time.Millisecond
	fx.cfg.OnFatal = fx.fatals.Record
	fx.feeds.succeedScript.after = dbErr

	_, stop := fx.start(t)

	waitFor(t, func() bool { return fx.fatals.Count() >= 1 }, "OnFatal after consecutive refresh database failures")
	stop()

	fatals := fx.fatals.Errors()
	if len(fatals) != 1 || !errors.Is(fatals[0], dbErr) {
		t.Fatalf("fatals = %v, want exactly one wrapping %v", fatals, dbErr)
	}

	if strings.Contains(fatals[0].Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", fatals[0].Error())
	}

	if claims := fx.feeds.claimList(); len(claims) < fatalFailureStreak {
		t.Fatalf("claims = %d, want at least %d before going fatal", len(claims), fatalFailureStreak)
	}

	if fx.recordedCount() != 0 {
		t.Fatal("database failures must never be recorded as feed failures")
	}
}

func TestRefreshLogsClaimFailureWithoutSecretsAndTruncated(t *testing.T) {
	logs := captureLogs(t)
	dbErr := domain.NewError(domain.ErrFeedRepositoryError, errors.New("claim failed for https://alice:secret@example.com/db "+strings.Repeat("x", 600)))

	fx := newRefreshFixture()
	fx.cfg.Concurrency = 1
	fx.cfg.PollInterval = 2 * time.Millisecond
	fx.cfg.OnFatal = fx.fatals.Record
	fx.feeds.claimScript.after = dbErr

	_, stop := fx.start(t)

	waitFor(t, func() bool { return strings.Contains(logs(), "claim due feed refresh failed") }, "claim failure logged")
	stop()

	out := logs()
	if strings.Contains(out, "alice:secret") {
		t.Fatalf("logs leaked credentials:\n%s", out)
	}

	if !strings.Contains(out, "...") {
		t.Fatalf("expected oversized log error to be truncated:\n%s", out)
	}
}
