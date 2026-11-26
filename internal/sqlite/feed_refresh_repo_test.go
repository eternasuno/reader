package sqlite

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"reader/internal/domain"
)

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

	err := store.Feeds().RecordRefreshFailure(context.Background(), feed.ID, summary, finishedAt.Add(-time.Second), finishedAt)
	if err != nil {
		t.Fatalf("record refresh failure: %v", err)
	}
}

func recordSuccess(t *testing.T, store *Store, feed domain.Feed, finishedAt time.Time) {
	t.Helper()

	err := store.Feeds().ApplySync(context.Background(), feed.ID, domain.FeedSyncMeta{Title: feed.Title}, finishedAt.Add(-time.Second), finishedAt, nil, nil)
	if err != nil {
		t.Fatalf("record refresh success: %v", err)
	}
}

func recordRefresh(t *testing.T, store *Store, feed domain.Feed, outcome refreshOutcome) {
	t.Helper()

	if outcome.failed {
		recordFailure(t, store, feed, outcome.summary, outcome.at)

		return
	}

	recordSuccess(t, store, feed, outcome.at)
}

func countRows(t *testing.T, store *Store, query string, args ...any) int {
	t.Helper()

	var count int
	if err := store.ReadDB().QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows %q: %v", query, err)
	}

	return count
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

func TestFeedRepoDerivesRefreshStateFromHistory(t *testing.T) {
	base := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)
	at := func(minutes int) time.Time { return base.Add(time.Duration(minutes) * time.Minute) }

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
			history:       []refreshOutcome{refreshFailed("e1", at(1)), refreshFailed("e2", at(2))},
			wantFailures:  2,
			wantLastError: ptr("e2"),
		},
		{
			name:          "failures after a success",
			history:       []refreshOutcome{refreshSucceeded(at(1)), refreshFailed("e2", at(2)), refreshFailed("e3", at(3))},
			wantUpdatedAt: ptrTime(at(1)),
			wantFailures:  2,
			wantLastError: ptr("e3"),
		},
		{
			name:          "success resets earlier failures",
			history:       []refreshOutcome{refreshFailed("e1", at(1)), refreshFailed("e2", at(2)), refreshSucceeded(at(3))},
			wantUpdatedAt: ptrTime(at(3)),
		},
		{
			name:          "only failures after the newest success count",
			history:       []refreshOutcome{refreshFailed("e1", at(1)), refreshSucceeded(at(2)), refreshFailed("e2", at(3)), refreshSucceeded(at(4)), refreshFailed("e3", at(5))},
			wantUpdatedAt: ptrTime(at(4)),
			wantFailures:  1,
			wantLastError: ptr("e3"),
		},
		{
			name:          "updated at is the newest success",
			history:       []refreshOutcome{refreshSucceeded(at(1)), refreshSucceeded(at(2))},
			wantUpdatedAt: ptrTime(at(2)),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t)
			feed := createFeed(t, store, "Example", nil)

			for _, outcome := range tc.history {
				recordRefresh(t, store, feed, outcome)
			}

			got, err := store.Feeds().GetByID(context.Background(), feed.ID)
			if err != nil || got == nil {
				t.Fatalf("get feed: (%v, %v)", got, err)
			}

			requireRefreshState(t, *got, tc.wantUpdatedAt, tc.wantFailures, tc.wantLastError)

			listed, err := store.Feeds().List(context.Background())
			if err != nil || len(listed) != 1 {
				t.Fatalf("list feeds: (%v, %v)", listed, err)
			}

			requireRefreshState(t, listed[0], tc.wantUpdatedAt, tc.wantFailures, tc.wantLastError)
		})
	}
}

func TestFeedRepoRecordRefreshFailureSanitizesError(t *testing.T) {
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
}

func TestFeedRepoPrunesRefreshHistoryToNewestTen(t *testing.T) {
	store := newTestStore(t)
	failing := createFeed(t, store, "Failing", nil)
	syncing := createFeed(t, store, "Syncing", nil)
	untouched := createFeed(t, store, "Untouched", nil)
	base := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)

	for i := 1; i <= 3; i++ {
		recordFailure(t, store, untouched, fmt.Sprintf("untouched %d", i), base.Add(time.Duration(i)*time.Minute))
	}

	for i := 1; i <= 12; i++ {
		recordFailure(t, store, failing, fmt.Sprintf("failure %d", i), base.Add(time.Duration(i)*time.Minute))
		recordSuccess(t, store, syncing, base.Add(time.Duration(i)*time.Minute))
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

	got, err := store.Feeds().GetByID(context.Background(), failing.ID)
	if err != nil || got == nil {
		t.Fatalf("get feed: (%v, %v)", got, err)
	}

	if got.FailureCount != 10 || got.LastError == nil || *got.LastError != "failure 12" {
		t.Fatalf("failing feed state = %d/%v, want 10/failure 12", got.FailureCount, got.LastError)
	}
}

func TestFeedRepoPruneKeepsNewestSucceededRefresh(t *testing.T) {
	store := newTestStore(t)
	feed := createFeed(t, store, "Example", nil)
	base := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)

	recordSuccess(t, store, feed, base)
	for i := 1; i <= 11; i++ {
		recordFailure(t, store, feed, fmt.Sprintf("failure %d", i), base.Add(time.Duration(i)*time.Minute))
	}

	got, err := store.Feeds().GetByID(context.Background(), feed.ID)
	if err != nil || got == nil {
		t.Fatalf("get feed: (%v, %v)", got, err)
	}

	requireRefreshState(t, *got, ptrTime(base), 10, ptr("failure 11"))

	if count := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ? AND status = ?`, feed.ID, string(domain.FeedRefreshSucceeded)); count != 1 {
		t.Fatalf("succeeded rows = %d, want the newest success kept", count)
	}

	if count := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, feed.ID); count != 11 {
		t.Fatalf("history rows = %d, want the newest ten failures plus the success", count)
	}
}

func TestFeedRepoDeleteCascadesRefreshHistory(t *testing.T) {
	store := newTestStore(t)
	deleted := createFeed(t, store, "Deleted", nil)
	kept := createFeed(t, store, "Kept", nil)
	now := time.Now().UTC()

	recordFailure(t, store, deleted, "boom", now)
	recordSuccess(t, store, deleted, now.Add(time.Minute))
	recordFailure(t, store, kept, "boom", now)

	if err := store.Feeds().Delete(context.Background(), deleted.ID); err != nil {
		t.Fatalf("delete feed: %v", err)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, deleted.ID); got != 0 {
		t.Fatalf("deleted feed history rows = %d, want 0", got)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed_refresh WHERE feed_id = ?`, kept.ID); got != 1 {
		t.Fatalf("kept feed history rows = %d, want 1", got)
	}
}

func TestFeedRepoRefreshOutcomesForDeletedFeedAreIgnored(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Deleted", nil)
	now := time.Now().UTC()

	if err := store.Feeds().Delete(ctx, feed.ID); err != nil {
		t.Fatalf("delete feed: %v", err)
	}

	if err := store.Feeds().RecordRefreshFailure(ctx, feed.ID, "boom", now, now); err != nil {
		t.Fatalf("record failure for deleted feed: %v", err)
	}

	items := []domain.FeedItem{{ID: domain.NewID(), URL: mustURL(t, "https://example.com/a"), Title: "A"}}
	if err := store.Feeds().ApplySync(ctx, feed.ID, domain.FeedSyncMeta{Title: "Gone"}, now, now, items, nil); err != nil {
		t.Fatalf("apply sync for deleted feed: %v", err)
	}

	if got := countRows(t, store, `SELECT (SELECT COUNT(*) FROM feed_refresh) + (SELECT COUNT(*) FROM feed_item)`); got != 0 {
		t.Fatalf("rows written for a deleted feed = %d, want 0", got)
	}
}

func TestFeedRepoApplySyncIsAtomicWithRefreshRecord(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	if _, err := store.WriteDB().ExecContext(
		ctx,
		`CREATE TRIGGER fail_refresh_insert BEFORE INSERT ON feed_refresh BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
	); err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	now := time.Now().UTC()
	items := []domain.FeedItem{{ID: domain.NewID(), URL: mustURL(t, "https://example.com/a"), Title: "A"}}
	err := store.Feeds().ApplySync(ctx, feed.ID, domain.FeedSyncMeta{Title: "Synced", SiteURL: ptr("https://example.com/")}, now, now, items, nil)
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
}
