package sqlite

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"reader/internal/domain"
)

var refreshBase = time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)

func refreshAt(minutes int) time.Time {
	return refreshBase.Add(time.Duration(minutes) * time.Minute)
}

type refreshOutcome struct {
	failed  bool
	summary string
	at      time.Time
}

func refreshSucceeded(at time.Time) refreshOutcome {
	return refreshOutcome{at: at}
}

func refreshFailed(summary string, at time.Time) refreshOutcome {
	return refreshOutcome{failed: true, summary: summary, at: at}
}

func recordFailure(t *testing.T, store *Store, feed domain.Feed, summary string, finishedAt time.Time) {
	t.Helper()

	attemptID := startRefresh(t, store, feed, finishedAt.Add(-time.Second))
	err := store.Feeds().FailRefresh(context.Background(), attemptID, feed.ID, summary, finishedAt, finishedAt.Add(testRefreshInterval))
	if err != nil {
		t.Fatalf("record refresh failure: %v", err)
	}
}

func recordSuccess(t *testing.T, store *Store, feed domain.Feed, finishedAt time.Time) {
	t.Helper()

	succeedRefresh(t, store, feed, domain.FeedSyncMeta{Title: feed.Title}, nil, finishedAt)
}

func recordRefresh(t *testing.T, store *Store, feed domain.Feed, outcome refreshOutcome) {
	t.Helper()

	if outcome.failed {
		recordFailure(t, store, feed, outcome.summary, outcome.at)

		return
	}

	recordSuccess(t, store, feed, outcome.at)
}

func claimDue(t *testing.T, store *Store, now time.Time) (*domain.Feed, string) {
	t.Helper()

	attemptID := domain.NewID()
	claimed, err := store.Feeds().ClaimDueRefresh(context.Background(), attemptID, now)
	if err != nil {
		t.Fatalf("claim due refresh: %v", err)
	}

	return claimed, attemptID
}

func requireClaimed(t *testing.T, claimed *domain.Feed, want domain.Feed) {
	t.Helper()

	if claimed == nil || claimed.ID != want.ID {
		t.Fatalf("claimed feed = %+v, want feed %q", claimed, want.Title)
	}
}

func requireNothingDue(t *testing.T, store *Store, now time.Time) {
	t.Helper()

	if claimed, _ := claimDue(t, store, now); claimed != nil {
		t.Fatalf("claimed feed %q at %v, want nothing due", claimed.Title, now)
	}
}

func nextRefreshAt(t *testing.T, store *Store, feed domain.Feed) time.Time {
	t.Helper()

	var millis int64
	err := store.ReadDB().QueryRowContext(context.Background(), `SELECT next_refresh_at FROM feed_schedule WHERE feed_id = ?`, feed.ID).Scan(&millis)
	if err != nil {
		t.Fatalf("read next refresh of feed %q: %v", feed.Title, err)
	}

	return millisToTime(millis)
}

func requireNextRefreshAt(t *testing.T, store *Store, feed domain.Feed, want time.Time) {
	t.Helper()

	if got := nextRefreshAt(t, store, feed); !got.Equal(want) {
		t.Fatalf("next refresh of feed %q = %v, want %v", feed.Title, got, want)
	}
}

func countRefreshRows(t *testing.T, store *Store, feed domain.Feed, status string) int {
	t.Helper()

	return countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ? AND status = ?`, feed.ID, status)
}

func requireFeedState(t *testing.T, store *Store, feed domain.Feed, updatedAt *time.Time, failureCount int, lastError *string) {
	t.Helper()

	got, err := store.Feeds().GetByID(context.Background(), feed.ID)
	if err != nil || got == nil {
		t.Fatalf("get feed %q: (%v, %v)", feed.Title, got, err)
	}

	requireRefreshState(t, *got, updatedAt, failureCount, lastError)
}

func requireRefreshState(t *testing.T, got domain.Feed, updatedAt *time.Time, failureCount int, lastError *string) {
	t.Helper()

	if (got.UpdatedAt == nil) != (updatedAt == nil) || (got.UpdatedAt != nil && !got.UpdatedAt.Equal(*updatedAt)) {
		t.Fatalf("updated at = %v, want %v", got.UpdatedAt, updatedAt)
	}

	if got.FailureCount != failureCount {
		t.Fatalf("failure count = %d, want %d", got.FailureCount, failureCount)
	}

	if (got.LastError == nil) != (lastError == nil) || (got.LastError != nil && *got.LastError != *lastError) {
		t.Fatalf("last error = %v, want %v", got.LastError, lastError)
	}
}

func TestFeedRepoReadsRefreshStateFromSchedule(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)
	succeededAt := refreshAt(5)

	_, err := store.WriteDB().ExecContext(
		ctx,
		`UPDATE feed_schedule SET last_success_at = ?, consecutive_failures = 7, last_error = 'stored' WHERE feed_id = ?`,
		timeToMillis(succeededAt),
		feed.ID,
	)
	if err != nil {
		t.Fatalf("write schedule: %v", err)
	}

	requireFeedState(t, store, feed, &succeededAt, 7, ptr("stored"))

	listed, err := store.Feeds().List(ctx)
	if err != nil || len(listed) != 1 {
		t.Fatalf("list feeds: (%v, %v)", listed, err)
	}

	requireRefreshState(t, listed[0], &succeededAt, 7, ptr("stored"))

	_, exported, err := store.Feeds().ExportOPML(ctx)
	if err != nil || len(exported) != 1 {
		t.Fatalf("export feeds: (%v, %v)", exported, err)
	}

	requireRefreshState(t, exported[0], &succeededAt, 7, ptr("stored"))

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh`); got != 0 {
		t.Fatalf("feed_refresh rows = %d, want 0: the state must not come from history", got)
	}
}

func TestFeedRepoRefreshOutcomesUpdateAggregates(t *testing.T) {
	tests := []struct {
		name          string
		history       []refreshOutcome
		wantUpdatedAt *time.Time
		wantFailures  int
		wantLastError *string
	}{
		{name: "no refreshes"},
		{
			name:          "failures only",
			history:       []refreshOutcome{refreshFailed("e1", refreshAt(1)), refreshFailed("e2", refreshAt(2))},
			wantFailures:  2,
			wantLastError: ptr("e2"),
		},
		{
			name:          "failures after a success",
			history:       []refreshOutcome{refreshSucceeded(refreshAt(1)), refreshFailed("e2", refreshAt(2)), refreshFailed("e3", refreshAt(3))},
			wantUpdatedAt: ptrTime(refreshAt(1)),
			wantFailures:  2,
			wantLastError: ptr("e3"),
		},
		{
			name:          "success resets earlier failures",
			history:       []refreshOutcome{refreshFailed("e1", refreshAt(1)), refreshFailed("e2", refreshAt(2)), refreshSucceeded(refreshAt(3))},
			wantUpdatedAt: ptrTime(refreshAt(3)),
		},
		{
			name:          "only failures after the newest success count",
			history:       []refreshOutcome{refreshFailed("e1", refreshAt(1)), refreshSucceeded(refreshAt(2)), refreshFailed("e2", refreshAt(3)), refreshSucceeded(refreshAt(4)), refreshFailed("e3", refreshAt(5))},
			wantUpdatedAt: ptrTime(refreshAt(4)),
			wantFailures:  1,
			wantLastError: ptr("e3"),
		},
		{
			name:          "updated at is the newest success",
			history:       []refreshOutcome{refreshSucceeded(refreshAt(1)), refreshSucceeded(refreshAt(2))},
			wantUpdatedAt: ptrTime(refreshAt(2)),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t)
			feed := createFeed(t, store, "Example", nil)

			for _, outcome := range tc.history {
				recordRefresh(t, store, feed, outcome)
			}

			requireFeedState(t, store, feed, tc.wantUpdatedAt, tc.wantFailures, tc.wantLastError)

			listed, err := store.Feeds().List(context.Background())
			if err != nil || len(listed) != 1 {
				t.Fatalf("list feeds: (%v, %v)", listed, err)
			}

			requireRefreshState(t, listed[0], tc.wantUpdatedAt, tc.wantFailures, tc.wantLastError)
		})
	}
}

func TestFeedRepoSucceedRefreshResetsFailuresAndSchedulesNext(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	recordFailure(t, store, feed, "e1", refreshAt(1))
	recordFailure(t, store, feed, "e2", refreshAt(2))
	requireFeedState(t, store, feed, nil, 2, ptr("e2"))

	attemptID := startRefresh(t, store, feed, refreshAt(59))
	nextAt := refreshAt(90)
	err := store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, domain.FeedSyncMeta{Title: "Example"}, nil, refreshAt(60), nextAt)
	if err != nil {
		t.Fatalf("succeed refresh: %v", err)
	}

	requireFeedState(t, store, feed, ptrTime(refreshAt(60)), 0, nil)
	requireNextRefreshAt(t, store, feed, nextAt)

	finished := queryStrings(t, store.ReadDB(), `SELECT status || ':' || COALESCE(error, 'none') || ':' || finished_at FROM feed_refresh WHERE id = ?`, attemptID)
	if want := []string{fmt.Sprintf("succeeded:none:%d", timeToMillis(refreshAt(60)))}; !slices.Equal(finished, want) {
		t.Fatalf("attempt row = %v, want %v", finished, want)
	}
}

func TestFeedRepoFailRefreshCountsFailureAndKeepsLastSuccess(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	recordSuccess(t, store, feed, refreshAt(1))

	attemptID := startRefresh(t, store, feed, refreshAt(59))
	nextAt := refreshAt(90)
	if err := store.Feeds().FailRefresh(ctx, attemptID, feed.ID, "boom", refreshAt(60), nextAt); err != nil {
		t.Fatalf("fail refresh: %v", err)
	}

	requireFeedState(t, store, feed, ptrTime(refreshAt(1)), 1, ptr("boom"))
	requireNextRefreshAt(t, store, feed, nextAt)

	finished := queryStrings(t, store.ReadDB(), `SELECT status || ':' || error || ':' || finished_at FROM feed_refresh WHERE id = ?`, attemptID)
	if want := []string{fmt.Sprintf("failed:boom:%d", timeToMillis(refreshAt(60)))}; !slices.Equal(finished, want) {
		t.Fatalf("attempt row = %v, want %v", finished, want)
	}
}

func TestFeedRepoFailRefreshSanitizesError(t *testing.T) {
	store := newTestStore(t)
	feed := createFeed(t, store, "Example", nil)

	recordFailure(t, store, feed, "refresh failed for https://user:secret@example.com/feed.xml", time.Now().UTC())

	got, err := store.Feeds().GetByID(context.Background(), feed.ID)
	if err != nil || got == nil {
		t.Fatalf("get feed: (%v, %v)", got, err)
	}

	if got.LastError == nil || *got.LastError != "refresh failed for https://example.com/feed.xml" {
		t.Fatalf("last error = %v, want the credentials stripped", got.LastError)
	}

	history := queryStrings(t, store.ReadDB(), `SELECT error FROM feed_refresh WHERE feed_id = ?`, feed.ID)
	if want := []string{"refresh failed for https://example.com/feed.xml"}; !slices.Equal(history, want) {
		t.Fatalf("stored attempt errors = %v, want %v", history, want)
	}
}

func TestFeedRepoPrunesRefreshHistoryToNewestTen(t *testing.T) {
	store := newTestStore(t)
	failing := createFeed(t, store, "Failing", nil)
	syncing := createFeed(t, store, "Syncing", nil)
	untouched := createFeed(t, store, "Untouched", nil)

	for i := 1; i <= 3; i++ {
		recordFailure(t, store, untouched, fmt.Sprintf("untouched %d", i), refreshAt(i))
	}

	for i := 1; i <= 12; i++ {
		recordFailure(t, store, failing, fmt.Sprintf("failure %d", i), refreshAt(i))
		recordSuccess(t, store, syncing, refreshAt(i))
	}

	retained := queryStrings(t, store.ReadDB(), `SELECT error FROM feed_refresh WHERE feed_id = ? ORDER BY id`, failing.ID)
	want := []string{"failure 3", "failure 4", "failure 5", "failure 6", "failure 7", "failure 8", "failure 9", "failure 10", "failure 11", "failure 12"}
	if !slices.Equal(retained, want) {
		t.Fatalf("retained failing history = %v, want the newest ten %v", retained, want)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, syncing.ID); got != 10 {
		t.Fatalf("syncing feed history rows = %d, want 10", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, untouched.ID); got != 3 {
		t.Fatalf("untouched feed history rows = %d, want 3", got)
	}

	requireFeedState(t, store, failing, nil, 12, ptr("failure 12"))
}

func TestFeedRepoPruneKeepsRunningAttempts(t *testing.T) {
	store := newTestStore(t)
	feed := createFeed(t, store, "Example", nil)
	running := startRefresh(t, store, feed, refreshAt(0))

	for i := 1; i <= 12; i++ {
		recordFailure(t, store, feed, fmt.Sprintf("failure %d", i), refreshAt(i))
	}

	if got := countRefreshRows(t, store, feed, "running"); got != 1 {
		t.Fatalf("running rows = %d, want the running attempt kept", got)
	}

	if got := countRefreshRows(t, store, feed, "failed"); got != feedRefreshLimit {
		t.Fatalf("failed rows = %d, want the newest %d", got, feedRefreshLimit)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE id = ? AND status = 'running'`, running); got != 1 {
		t.Fatalf("running attempt %q was pruned", running)
	}
}

func TestFeedRepoPruneDoesNotKeepNewestSucceededRefresh(t *testing.T) {
	store := newTestStore(t)
	feed := createFeed(t, store, "Example", nil)

	recordSuccess(t, store, feed, refreshAt(0))
	for i := 1; i <= 11; i++ {
		recordFailure(t, store, feed, fmt.Sprintf("failure %d", i), refreshAt(i))
	}

	requireFeedState(t, store, feed, ptrTime(refreshAt(0)), 11, ptr("failure 11"))

	if got := countRefreshRows(t, store, feed, "succeeded"); got != 0 {
		t.Fatalf("succeeded rows = %d, want the success pruned with the oldest history", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, feed.ID); got != feedRefreshLimit {
		t.Fatalf("history rows = %d, want the newest %d", got, feedRefreshLimit)
	}
}

func TestFeedRepoDeleteCascadesRefreshState(t *testing.T) {
	store := newTestStore(t)
	deleted := createFeed(t, store, "Deleted", nil)
	kept := createFeed(t, store, "Kept", nil)

	recordFailure(t, store, deleted, "boom", refreshAt(1))
	recordSuccess(t, store, deleted, refreshAt(2))
	recordFailure(t, store, kept, "boom", refreshAt(1))

	if err := store.Feeds().Delete(context.Background(), deleted.ID); err != nil {
		t.Fatalf("delete feed: %v", err)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, deleted.ID); got != 0 {
		t.Fatalf("deleted feed history rows = %d, want 0", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_schedule WHERE feed_id = ?`, deleted.ID); got != 0 {
		t.Fatalf("deleted feed schedule rows = %d, want 0", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, kept.ID); got != 1 {
		t.Fatalf("kept feed history rows = %d, want 1", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_schedule WHERE feed_id = ?`, kept.ID); got != 1 {
		t.Fatalf("kept feed schedule rows = %d, want 1", got)
	}
}

func TestFeedRepoFinishForDeletedFeedIsIgnored(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeedDueAt(t, store, "Deleted", nil, refreshAt(0))

	claimed, attemptID := claimDue(t, store, refreshAt(1))
	requireClaimed(t, claimed, feed)

	if err := store.Feeds().Delete(ctx, feed.ID); err != nil {
		t.Fatalf("delete feed: %v", err)
	}

	items := []domain.ParsedFeedEntry{{URL: mustURL(t, "https://example.com/a"), Title: "A"}}
	err := store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, domain.FeedSyncMeta{Title: "Gone"}, items, refreshAt(2), refreshAt(32))
	if err != nil {
		t.Fatalf("succeed refresh for deleted feed: %v", err)
	}

	if err := store.Feeds().FailRefresh(ctx, attemptID, feed.ID, "boom", refreshAt(2), refreshAt(32)); err != nil {
		t.Fatalf("fail refresh for deleted feed: %v", err)
	}

	if err := store.Feeds().ReleaseRefresh(ctx, attemptID, feed.ID); err != nil {
		t.Fatalf("release refresh for deleted feed: %v", err)
	}

	if got := countRows(t, store, `SELECT (SELECT COUNT(*) FROM feed_refresh) + (SELECT COUNT(*) FROM feed_item) + (SELECT COUNT(*) FROM feed_schedule)`); got != 0 {
		t.Fatalf("rows written for a deleted feed = %d, want 0", got)
	}
}

func TestFeedRepoFinishReplayHasNoSecondEffect(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(0))

	claimed, attemptID := claimDue(t, store, refreshAt(1))
	requireClaimed(t, claimed, feed)

	if err := store.Settings().UpdateRetention(ctx, 1); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	first := []domain.ParsedFeedEntry{{URL: mustURL(t, "https://example.com/first"), Title: "First"}}
	err := store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, domain.FeedSyncMeta{Title: "First sync"}, first, refreshAt(2), refreshAt(32))
	if err != nil {
		t.Fatalf("succeed refresh: %v", err)
	}

	second := []domain.ParsedFeedEntry{{URL: mustURL(t, "https://example.com/second"), Title: "Second"}}
	err = store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, domain.FeedSyncMeta{Title: "Second sync"}, second, refreshAt(3), refreshAt(33))
	if err != nil {
		t.Fatalf("replay succeed refresh: %v", err)
	}

	if err := store.Feeds().FailRefresh(ctx, attemptID, feed.ID, "late failure", refreshAt(4), refreshAt(34)); err != nil {
		t.Fatalf("fail after succeed: %v", err)
	}

	got, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil || got == nil {
		t.Fatalf("get feed: (%v, %v)", got, err)
	}

	if got.Title != "First sync" {
		t.Fatalf("title = %q, want the first sync kept", got.Title)
	}

	requireRefreshState(t, *got, ptrTime(refreshAt(2)), 0, nil)
	requireNextRefreshAt(t, store, feed, refreshAt(32))

	stored := queryStrings(t, store.ReadDB(), `SELECT title FROM feed_item WHERE feed_id = ?`, feed.ID)
	if want := []string{"First"}; !slices.Equal(stored, want) {
		t.Fatalf("stored items = %v, want %v", stored, want)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ? AND status = 'succeeded'`, feed.ID); got != 1 {
		t.Fatalf("succeeded rows = %d, want 1", got)
	}

	if got := countRefreshRows(t, store, feed, "failed"); got != 0 {
		t.Fatalf("failed rows = %d, want 0", got)
	}
}

func TestFeedRepoFinishRequiresTheRunningAttemptOfTheFeed(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	owner := createFeedDueAt(t, store, "Owner", nil, refreshAt(0))
	other := createFeedDueAt(t, store, "Other", nil, refreshAt(0))
	attemptID := startRefresh(t, store, owner, refreshAt(1))

	wrongFeed := store.Feeds().FailRefresh(ctx, attemptID, other.ID, "boom", refreshAt(2), refreshAt(32))
	unknownAttempt := store.Feeds().FailRefresh(ctx, domain.NewID(), owner.ID, "boom", refreshAt(2), refreshAt(32))
	if wrongFeed != nil || unknownAttempt != nil {
		t.Fatalf("mismatched finish errors = (%v, %v), want none", wrongFeed, unknownAttempt)
	}

	for _, feed := range []domain.Feed{owner, other} {
		requireFeedState(t, store, feed, nil, 0, nil)
		requireNextRefreshAt(t, store, feed, refreshAt(0))
	}

	if got := countRefreshRows(t, store, owner, "running"); got != 1 {
		t.Fatalf("running rows of the owner = %d, want the attempt untouched", got)
	}
}

func TestFeedRepoSucceedRefreshUsesRetentionAtCommit(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)
	other := createFeed(t, store, "Other", nil)
	stored := addItems(t, store, feed, 3)
	otherItems := addItems(t, store, other, 2)
	attemptID := startRefresh(t, store, feed, refreshAt(1))

	entries := []domain.ParsedFeedEntry{
		{URL: mustURL(t, "https://example.com/new-top"), Title: "New top"},
		{URL: stored[2].URL, Title: "Duplicate of stored top"},
		{URL: stored[0].URL, Title: "Previously oldest"},
	}

	if err := store.Settings().UpdateRetention(ctx, 2); err != nil {
		t.Fatalf("lower retention after parsing: %v", err)
	}

	meta := domain.FeedSyncMeta{Title: feed.Title}
	if err := store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, meta, entries, refreshAt(2), refreshAt(32)); err != nil {
		t.Fatalf("succeed refresh: %v", err)
	}

	urls := queryStrings(t, store.ReadDB(), `SELECT url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, feed.ID)
	if want := []string{entries[0].URL.Raw(), entries[1].URL.Raw()}; !slices.Equal(urls, want) {
		t.Fatalf("retained URLs = %v, want %v", urls, want)
	}

	if got := itemIDs(loadTestFeedItems(t, store, other.ID)); !slices.Equal(got, []string{otherItems[1].ID, otherItems[0].ID}) {
		t.Fatalf("other feed items = %v, want both unchanged", got)
	}
}

func TestFeedRepoSucceedRefreshIsAtomic(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(0))

	claimed, attemptID := claimDue(t, store, refreshAt(1))
	requireClaimed(t, claimed, feed)

	if _, err := store.WriteDB().ExecContext(
		ctx,
		`CREATE TRIGGER fail_schedule_update BEFORE UPDATE ON feed_schedule BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
	); err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	items := []domain.ParsedFeedEntry{{URL: mustURL(t, "https://example.com/a"), Title: "A"}}
	meta := domain.FeedSyncMeta{Title: "Synced", SiteURL: ptr("https://example.com/")}
	err := store.Feeds().SucceedRefresh(ctx, attemptID, feed.ID, meta, items, refreshAt(2), refreshAt(32))
	requireCode(t, err, domain.ErrFeedRepositoryError)

	got, getErr := store.Feeds().GetByID(ctx, feed.ID)
	if getErr != nil || got == nil {
		t.Fatalf("get feed: (%v, %v)", got, getErr)
	}

	if got.Title != "Example" || got.SiteURL != nil {
		t.Fatalf("feed after failed sync = %+v, want the metadata unchanged", got)
	}

	if count := countRows(t, store, `SELECT COUNT(*) FROM feed_item WHERE feed_id = ?`, feed.ID); count != 0 {
		t.Fatalf("items after failed sync = %d, want 0", count)
	}

	if count := countRefreshRows(t, store, feed, "running"); count != 1 {
		t.Fatalf("running rows after failed sync = %d, want the attempt still running", count)
	}
}

func TestFeedRepoClaimDueRefreshPicksOldestDue(t *testing.T) {
	store := newTestStore(t)
	late := createFeedDueAt(t, store, "Late", nil, refreshAt(3))
	// Inserted in reverse ID order so only the feed_id tie-break, not insertion
	// order, claims the smaller ID first.
	tied := createFeedWithIDDueAt(t, store, "ffffffff-0000-7000-8000-000000000002", "Tied", nil, refreshAt(1))
	first := createFeedWithIDDueAt(t, store, "ffffffff-0000-7000-8000-000000000001", "First", nil, refreshAt(1))
	middle := createFeedDueAt(t, store, "Middle", nil, refreshAt(2))

	for _, want := range []domain.Feed{first, tied, middle, late} {
		claimed, _ := claimDue(t, store, refreshAt(10))
		requireClaimed(t, claimed, want)
	}

	requireNothingDue(t, store, refreshAt(10))

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE status = 'running'`); got != 4 {
		t.Fatalf("running rows = %d, want one per claimed feed", got)
	}
}

func TestFeedRepoClaimDueRefreshSkipsNotDue(t *testing.T) {
	store := newTestStore(t)

	requireNothingDue(t, store, refreshAt(10))

	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(10))

	requireNothingDue(t, store, refreshAt(9))

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh`); got != 0 {
		t.Fatalf("attempt rows after unsuccessful claims = %d, want 0", got)
	}

	claimed, _ := claimDue(t, store, refreshAt(10))
	requireClaimed(t, claimed, feed)
}

func TestFeedRepoClaimDueRefreshSkipsFeedsWithRunningAttempt(t *testing.T) {
	store := newTestStore(t)
	running := createFeedDueAt(t, store, "Running", nil, refreshAt(0))
	waiting := createFeedDueAt(t, store, "Waiting", nil, refreshAt(1))

	claimed, _ := claimDue(t, store, refreshAt(5))
	requireClaimed(t, claimed, running)

	claimed, _ = claimDue(t, store, refreshAt(5))
	requireClaimed(t, claimed, waiting)

	requireNothingDue(t, store, refreshAt(5))
}

func TestFeedRepoClaimDueRefreshRecordsRunningAttempt(t *testing.T) {
	store := newTestStore(t)
	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(0))

	recordFailure(t, store, feed, "boom", refreshAt(1))

	claimedAt := refreshAt(40)
	claimed, attemptID := claimDue(t, store, claimedAt)
	requireClaimed(t, claimed, feed)
	requireRefreshState(t, *claimed, nil, 1, ptr("boom"))

	requireNextRefreshAt(t, store, feed, refreshAt(1).Add(testRefreshInterval))
	requireFeedState(t, store, feed, nil, 1, ptr("boom"))

	running := queryStrings(t, store.ReadDB(), `SELECT id || ':' || status || ':' || started_at || ':' || COALESCE(finished_at, 'null') FROM feed_refresh WHERE status = 'running'`)
	if want := []string{fmt.Sprintf("%s:running:%d:null", attemptID, timeToMillis(claimedAt))}; !slices.Equal(running, want) {
		t.Fatalf("running rows = %v, want %v", running, want)
	}
}

func TestFeedRepoClaimDueRefreshWaitsForScheduledTimeAfterFinish(t *testing.T) {
	store := newTestStore(t)
	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(0))

	claimed, attemptID := claimDue(t, store, refreshAt(1))
	requireClaimed(t, claimed, feed)

	err := store.Feeds().SucceedRefresh(context.Background(), attemptID, feed.ID, domain.FeedSyncMeta{Title: "Example"}, nil, refreshAt(2), refreshAt(32))
	if err != nil {
		t.Fatalf("succeed refresh: %v", err)
	}

	requireNothingDue(t, store, refreshAt(31))

	claimed, _ = claimDue(t, store, refreshAt(32))
	requireClaimed(t, claimed, feed)
}

func TestFeedRepoReleaseRefreshLeavesFeedDueAndAggregatesUnchanged(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeedDueAt(t, store, "Example", nil, refreshAt(0))

	recordSuccess(t, store, feed, refreshAt(1))

	nextAt := refreshAt(1).Add(testRefreshInterval)
	claimedAt := nextAt.Add(time.Minute)
	claimed, attemptID := claimDue(t, store, claimedAt)
	requireClaimed(t, claimed, feed)

	if err := store.Feeds().ReleaseRefresh(ctx, attemptID, feed.ID); err != nil {
		t.Fatalf("release refresh: %v", err)
	}

	if got := countRefreshRows(t, store, feed, "running"); got != 0 {
		t.Fatalf("running rows after release = %d, want 0", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, feed.ID); got != 1 {
		t.Fatalf("history rows after release = %d, want only the earlier success", got)
	}

	requireFeedState(t, store, feed, ptrTime(refreshAt(1)), 0, nil)
	requireNextRefreshAt(t, store, feed, nextAt)

	again, secondAttemptID := claimDue(t, store, claimedAt)
	requireClaimed(t, again, feed)

	if err := store.Feeds().FailRefresh(ctx, secondAttemptID, feed.ID, "boom", claimedAt, claimedAt.Add(testRefreshInterval)); err != nil {
		t.Fatalf("fail refresh: %v", err)
	}

	if err := store.Feeds().ReleaseRefresh(ctx, secondAttemptID, feed.ID); err != nil {
		t.Fatalf("release finished attempt: %v", err)
	}

	if got := countRefreshRows(t, store, feed, "failed"); got != 1 {
		t.Fatalf("failed rows after releasing a finished attempt = %d, want the outcome kept", got)
	}
}

func TestFeedRepoRecoverRunningRefreshes(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	full := createFeedDueAt(t, store, "Full", nil, refreshAt(0))
	fresh := createFeedDueAt(t, store, "Fresh", nil, refreshAt(0))
	finished := createFeedDueAt(t, store, "Finished", nil, refreshAt(0))

	for i := 1; i <= feedRefreshLimit; i++ {
		recordFailure(t, store, full, fmt.Sprintf("failure %d", i), refreshAt(i))
	}

	recordSuccess(t, store, finished, refreshAt(1))

	fullNext := nextRefreshAt(t, store, full)
	startRefresh(t, store, full, refreshAt(100))
	startRefresh(t, store, fresh, refreshAt(100))

	recoveredAt := refreshAt(101)
	for range 2 {
		if err := store.Feeds().RecoverRunningRefreshes(ctx, recoveredAt); err != nil {
			t.Fatalf("recover running refreshes: %v", err)
		}

		requireRecoveredRefreshes(t, store, full, fresh, recoveredAt)
		requireFeedState(t, store, finished, ptrTime(refreshAt(1)), 0, nil)
		requireNextRefreshAt(t, store, full, fullNext)
		requireNextRefreshAt(t, store, fresh, refreshAt(0))
	}

	claimed, _ := claimDue(t, store, refreshAt(102))
	requireClaimed(t, claimed, fresh)
}

func requireRecoveredRefreshes(t *testing.T, store *Store, full, fresh domain.Feed, recoveredAt time.Time) {
	t.Helper()

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE status = 'running'`); got != 0 {
		t.Fatalf("running rows after recovery = %d, want 0", got)
	}

	interrupted := queryStrings(t, store.ReadDB(), `SELECT error || ':' || finished_at FROM feed_refresh WHERE feed_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`, full.ID)
	if want := []string{fmt.Sprintf("interrupted:%d", timeToMillis(recoveredAt))}; !slices.Equal(interrupted, want) {
		t.Fatalf("newest attempt of the full feed = %v, want %v", interrupted, want)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, full.ID); got != feedRefreshLimit {
		t.Fatalf("full feed history rows = %d, want pruned to %d", got, feedRefreshLimit)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ? AND error = 'failure 1'`, full.ID); got != 0 {
		t.Fatalf("oldest attempt of the full feed survived the pruning")
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ? AND status = 'failed' AND error = 'interrupted'`, fresh.ID); got != 1 {
		t.Fatalf("interrupted rows of the fresh feed = %d, want 1", got)
	}

	requireFeedState(t, store, full, nil, feedRefreshLimit, ptr(fmt.Sprintf("failure %d", feedRefreshLimit)))
	requireFeedState(t, store, fresh, nil, 0, nil)
}

func TestFeedRepoRequestRefresh(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := refreshAt(5)

	if err := store.Feeds().RequestRefresh(ctx, "missing", now); err != nil {
		t.Fatalf("request refresh of a missing feed: %v", err)
	}

	waiting := createFeedDueAt(t, store, "Waiting", nil, refreshAt(0))
	recordSuccess(t, store, waiting, refreshAt(1))
	overdue := createFeedDueAt(t, store, "Overdue", nil, refreshAt(2))
	running := createFeedDueAt(t, store, "Running", nil, refreshAt(0))
	startRefresh(t, store, running, refreshAt(1))

	for _, feed := range []domain.Feed{waiting, overdue, running} {
		if err := store.Feeds().RequestRefresh(ctx, feed.ID, now); err != nil {
			t.Fatalf("request refresh of feed %q: %v", feed.Title, err)
		}
	}

	requireNextRefreshAt(t, store, waiting, now)
	requireNextRefreshAt(t, store, overdue, refreshAt(2))
	requireNextRefreshAt(t, store, running, refreshAt(0))

	claimed, _ := claimDue(t, store, now)
	requireClaimed(t, claimed, overdue)

	claimed, _ = claimDue(t, store, now)
	requireClaimed(t, claimed, waiting)

	requireNothingDue(t, store, now)
}
