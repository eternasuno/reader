package sqlite

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"reader/internal/domain"
)

func requireFileMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}

	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode = %04o, want %04o", path, got, want)
	}
}

func configureKindleDeliveryForTest(t *testing.T, store *Store, kindle domain.KindleSettings, now time.Time) {
	t.Helper()

	ctx := context.Background()
	smtp := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptr("smtp-user"),
		Password:    ptr("smtp-password"),
	}
	if err := store.Settings().UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	if err := store.Settings().UpdateKindle(ctx, kindle, now); err != nil {
		t.Fatalf("update kindle: %v", err)
	}
}

// corruptScheduleAssignments are stored values no validated write can produce.
var corruptScheduleAssignments = map[string]string{
	"hour above 23":                 `send_hour = 24`,
	"minute above 55":               `send_minute = 60`,
	"minute not a multiple of five": `send_minute = 7`,
	"unloadable timezone":           `timezone = 'Mars/Olympus_Mons'`,
	"padded timezone":               `timezone = ' UTC'`,
}

func corruptStoredSchedule(t *testing.T, store *Store, assignment string) {
	t.Helper()

	if _, err := store.WriteDB().ExecContext(context.Background(), `UPDATE setting SET `+assignment+` WHERE id = 1`); err != nil {
		t.Fatalf("corrupt stored schedule with %q: %v", assignment, err)
	}
}

func configureManualKindleForTest(t *testing.T, store *Store) {
	t.Helper()

	kindle := domain.KindleSettings{KindleEmail: "reader@kindle.com"}
	configureKindleDeliveryForTest(t, store, kindle, time.Time{})
}

func newTestStore(t *testing.T) *Store {
	t.Helper()

	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "reader.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}

	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close store: %v", err)
		}
	})

	return store
}

func mustURL(t *testing.T, raw string) domain.NormalizedURL {
	t.Helper()

	parsed, err := domain.ParseNormalizedURL(raw, domain.ErrFeedUrlInvalid)
	if err != nil {
		t.Fatalf("parse url %q: %v", raw, err)
	}

	return parsed
}

const maxTestBoundary = "ffffffff-ffff-7fff-8000-ffffffffffff"

func fixedTestID(seq uint64) string {
	return fmt.Sprintf("01950000-0000-7000-8000-%012x", seq)
}

func ptr(value string) *string {
	return &value
}

func ptrTime(value time.Time) *time.Time {
	return &value
}

func createFolder(t *testing.T, store *Store, name string) domain.Folder {
	t.Helper()

	folder, err := store.Folders().Create(context.Background(), domain.NewID(), name)
	if err != nil {
		t.Fatalf("create folder %q: %v", name, err)
	}

	return folder
}

const testRefreshInterval = 30 * time.Minute

func createFeed(t *testing.T, store *Store, title string, folderID *string) domain.Feed {
	t.Helper()

	return createFeedDueAt(t, store, title, folderID, time.Now().UTC())
}

func createFeedDueAt(t *testing.T, store *Store, title string, folderID *string, dueAt time.Time) domain.Feed {
	t.Helper()

	return createFeedWithIDDueAt(t, store, domain.NewID(), title, folderID, dueAt)
}

func createFeedWithIDDueAt(t *testing.T, store *Store, id string, title string, folderID *string, dueAt time.Time) domain.Feed {
	t.Helper()

	feed, err := store.Feeds().Create(context.Background(), domain.Feed{
		ID:         id,
		URL:        mustURL(t, "https://example.com/feeds/"+domain.NewID()),
		Title:      title,
		FolderID:   folderID,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, dueAt)
	if err != nil {
		t.Fatalf("create feed %q: %v", title, err)
	}

	return feed
}

// startRefresh records a running attempt for the feed the way ClaimDueRefresh
// does, without choosing the feed by schedule order.
func startRefresh(t *testing.T, store *Store, feed domain.Feed, startedAt time.Time) string {
	t.Helper()

	attemptID := domain.NewID()
	_, err := store.WriteDB().ExecContext(
		context.Background(),
		`INSERT INTO feed_refresh (id, feed_id, status, started_at) VALUES (?, ?, 'running', ?)`,
		attemptID,
		feed.ID,
		timeToMillis(startedAt),
	)
	if err != nil {
		t.Fatalf("start refresh for feed %q: %v", feed.Title, err)
	}

	return attemptID
}

// succeedRefresh runs one successful refresh attempt that finishes at finishedAt.
func succeedRefresh(t *testing.T, store *Store, feed domain.Feed, meta domain.FeedSyncMeta, items []domain.FeedItem, deleteIDs []string, finishedAt time.Time) {
	t.Helper()

	attemptID := startRefresh(t, store, feed, finishedAt.Add(-time.Second))
	err := store.Feeds().SucceedRefresh(context.Background(), attemptID, feed.ID, meta, items, deleteIDs, finishedAt, finishedAt.Add(testRefreshInterval))
	if err != nil {
		t.Fatalf("succeed refresh of feed %q: %v", feed.Title, err)
	}
}

// syncFeed stores items in the feed through one successful refresh attempt.
func syncFeed(t *testing.T, store *Store, feed domain.Feed, items []domain.FeedItem, deleteIDs []string) {
	t.Helper()

	succeedRefresh(t, store, feed, domain.FeedSyncMeta{Title: feed.Title}, items, deleteIDs, time.Now().UTC())
}

func addItems(t *testing.T, store *Store, feed domain.Feed, count int) []domain.FeedItem {
	t.Helper()

	items := make([]domain.FeedItem, count)
	for i := range items {
		items[i] = domain.FeedItem{
			ID:     domain.NewID(),
			FeedID: feed.ID,
			URL:    mustURL(t, "https://example.com/items/"+domain.NewID()),
			Title:  fmt.Sprintf("%s item %d", feed.Title, i),
		}
	}

	syncFeed(t, store, feed, items, nil)

	return items
}

func folderIDByName(t *testing.T, store *Store, name string) string {
	t.Helper()

	folders, err := store.Folders().List(context.Background())
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	for _, folder := range folders {
		if folder.Name == name {
			return folder.ID
		}
	}

	t.Fatalf("folder %q not found", name)

	return ""
}

func itemIDs(items []domain.FeedItem) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}

	return ids
}

func savedPageIDs(pages []domain.SavedPage) []string {
	ids := make([]string, len(pages))
	for i, page := range pages {
		ids[i] = page.ID
	}

	return ids
}

func unreadCountMap(counts []domain.FeedUnreadCount) map[string]int {
	byFeed := make(map[string]int, len(counts))
	for _, count := range counts {
		byFeed[count.FeedID] = count.Count
	}

	return byFeed
}

func requireCode(t *testing.T, err error, code domain.ErrorCode) *domain.DomainError {
	t.Helper()

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected domain error %s, got %v", code, err)
	}

	if domainErr.Code != code {
		t.Fatalf("error code = %s, want %s", domainErr.Code, code)
	}

	return domainErr
}

func assertSMTPSettings(t *testing.T, got domain.SMTPSettings, want domain.SMTPSettings) {
	t.Helper()

	if got.SenderEmail != want.SenderEmail || got.Host != want.Host || got.Port != want.Port || got.Security != want.Security {
		t.Fatalf("smtp settings = %+v, want %+v", got, want)
	}

	if got.User == nil || *got.User != *want.User {
		t.Fatalf("smtp user = %v, want %v", got.User, want.User)
	}

	if got.Password == nil || *got.Password != *want.Password {
		t.Fatalf("smtp password was not stored")
	}
}

func assertKindleSettings(t *testing.T, got domain.KindleSettings, want domain.KindleSettings) {
	t.Helper()

	if got.KindleEmail != want.KindleEmail {
		t.Fatalf("kindle email = %q, want %q", got.KindleEmail, want.KindleEmail)
	}

	if !reflect.DeepEqual(got.Schedule, want.Schedule) {
		t.Fatalf("kindle schedule = %+v, want %+v", got.Schedule, want.Schedule)
	}
}

func countRows(t *testing.T, store *Store, query string, args ...any) int {
	t.Helper()

	var count int
	if err := store.ReadDB().QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows %q: %v", query, err)
	}

	return count
}

func queryPlan(t *testing.T, store *Store, query string, args ...any) []string {
	t.Helper()

	rows, err := store.ReadDB().QueryContext(context.Background(), `EXPLAIN QUERY PLAN `+query, args...)
	if err != nil {
		t.Fatalf("explain query plan: %v", err)
	}

	defer rows.Close()

	details := []string{}
	for rows.Next() {
		var id int
		var parent int
		var notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatalf("scan query plan: %v", err)
		}

		details = append(details, detail)
	}

	if err := rows.Err(); err != nil {
		t.Fatalf("read query plan: %v", err)
	}

	if len(details) == 0 {
		t.Fatalf("query plan for %q is empty", query)
	}

	return details
}

func requireIndexedPlan(t *testing.T, name string, details []string, index string, allowTempBTree bool) {
	t.Helper()

	plan := strings.Join(details, "\n")
	if !allowTempBTree && strings.Contains(plan, "USE TEMP B-TREE") {
		t.Fatalf("%s: plan uses a temporary b-tree:\n%s", name, plan)
	}

	for _, detail := range details {
		if detail == "SCAN feed_item" || detail == "SCAN saved_page" || detail == "SCAN feed_refresh" || detail == "SCAN feed_schedule" {
			t.Fatalf("%s: plan scans the table without an index:\n%s", name, plan)
		}
	}

	if index != "" && !planUsesIndex(details, index) {
		t.Fatalf("%s: plan does not use index %q:\n%s", name, index, plan)
	}
}

// requireRefreshLookupsIndexed checks every feed_refresh access in a plan is a
// keyed SEARCH on feed_refresh_feed_id_id, never a table or full index scan.
func requireRefreshLookupsIndexed(t *testing.T, name string, details []string) {
	t.Helper()

	for _, detail := range details {
		if !strings.Contains(detail, " feed_refresh ") {
			continue
		}

		if !strings.HasPrefix(detail, "SEARCH ") || !planUsesIndex([]string{detail}, "feed_refresh_feed_id_id") {
			t.Fatalf("%s: feed_refresh lookup is not a keyed search on feed_refresh_feed_id_id: %q", name, detail)
		}
	}
}

// requireFeedScheduleJoinedByKey checks the feed_schedule side of a feed query
// is a keyed SEARCH on feed_id, never a scan.
func requireFeedScheduleJoinedByKey(t *testing.T, name string, details []string) {
	t.Helper()

	joinedByKey := slices.ContainsFunc(details, func(detail string) bool {
		return strings.HasPrefix(detail, "SEARCH feed_schedule USING ") && strings.HasSuffix(detail, "(feed_id=?)")
	})
	if !joinedByKey {
		t.Fatalf("%s: feed_schedule is not joined by a keyed search on feed_id:\n%s", name, strings.Join(details, "\n"))
	}
}

// requireNoRefreshHistoryAccess checks a feed query reads its refresh
// aggregates from feed_schedule and never touches feed_refresh.
func requireNoRefreshHistoryAccess(t *testing.T, name string, details []string) {
	t.Helper()

	if slices.ContainsFunc(details, func(detail string) bool { return strings.Contains(detail, "feed_refresh") }) {
		t.Fatalf("%s: plan reads feed_refresh:\n%s", name, strings.Join(details, "\n"))
	}
}

// planUsesIndex matches the whole index name so that an index never satisfies
// a check for another index it is a prefix of (feed_item_feed_id and
// feed_item_feed_id_url).
func planUsesIndex(details []string, index string) bool {
	pattern := regexp.MustCompile(`USING (?:COVERING )?INDEX ` + regexp.QuoteMeta(index) + `(?: |$)`)

	return slices.ContainsFunc(details, pattern.MatchString)
}
