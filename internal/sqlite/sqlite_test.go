package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"reader/internal/domain"
)

var (
	_ domain.FolderRepository     = (*FolderRepo)(nil)
	_ domain.FeedRepository       = (*FeedRepo)(nil)
	_ domain.FeedItemRepository   = (*FeedItemRepo)(nil)
	_ domain.SavedPageRepository  = (*SavedPageRepo)(nil)
	_ domain.SettingRepository    = (*SettingRepo)(nil)
	_ domain.KindleSendRepository = (*KindleSendRepo)(nil)
)

func TestOpenMigratesDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "nested", "state", "reader.db")
	ctx := context.Background()

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}

	if _, err := os.Stat(dbPath); err != nil {
		t.Fatalf("stat database file: %v", err)
	}

	if got := store.WriteDB().Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("write pool max open connections = %d, want 1", got)
	}

	if got := store.ReadDB().Stats().MaxOpenConnections; got != readPoolConnections {
		t.Fatalf("read pool max open connections = %d, want %d", got, readPoolConnections)
	}

	for _, db := range []*sql.DB{store.WriteDB(), store.ReadDB()} {
		var journalMode string
		if err := db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode); err != nil {
			t.Fatalf("read journal mode: %v", err)
		}

		if journalMode != "wal" {
			t.Fatalf("journal mode = %q, want wal", journalMode)
		}
	}

	for _, table := range []string{"folder", "feed", "feed_item", "saved_page", "setting", "kindle_send"} {
		var name string
		err := store.ReadDB().
			QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).
			Scan(&name)
		if err != nil {
			t.Fatalf("table %q is missing: %v", table, err)
		}
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Retention != 100 || settings.Provider != domain.ProviderDirect {
		t.Fatalf("default settings = %+v, want retention 100 and provider direct", settings)
	}

	if settings.SMTP != nil || settings.Kindle != nil || settings.JinaKey != nil || settings.BrowserEndpoint != nil {
		t.Fatalf("default settings carry unexpected optional values: %+v", settings)
	}

	if err := store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}

	defer reopened.Close()

	reloaded, err := reopened.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings after reopen: %v", err)
	}

	if reloaded.Retention != 100 || reloaded.Provider != domain.ProviderDirect {
		t.Fatalf("settings after reopen = %+v, want retention 100 and provider direct", reloaded)
	}
}

func TestOpenSupportsSpecialCharactersInPath(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "data?query=1#frag%20", "reader.db")
	ctx := context.Background()

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open store with special path chars: %v", err)
	}

	defer store.Close()

	if _, err := os.Stat(dbPath); err != nil {
		t.Fatalf("stat database file at special path: %v", err)
	}

	created, err := store.Folders().Create(ctx, domain.NewID(), "Special")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}

	got, err := store.Folders().GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("get folder: %v", err)
	}

	if got == nil || got.Name != "Special" {
		t.Fatalf("folder = %+v, want Special", got)
	}
}

func TestOpenResolvesRelativePaths(t *testing.T) {
	cases := []struct {
		name     string
		relative string
		topLevel string
	}{
		{name: "default data dir", relative: filepath.Join(".data", "reader.db"), topLevel: ".data"},
		{name: "bare file name", relative: "reader.db", topLevel: "reader.db"},
		{name: "dot prefixed", relative: filepath.Join(".", "nested", "reader.db"), topLevel: "nested"},
		{name: "query fragment and percent", relative: filepath.Join("data?query=1#frag%20%2F", "reader.db"), topLevel: "data?query=1#frag%20%2F"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			workDir := t.TempDir()
			t.Chdir(workDir)

			ctx := context.Background()

			store, err := Open(ctx, tc.relative)
			if err != nil {
				t.Fatalf("open store with relative path %q: %v", tc.relative, err)
			}

			folder, err := store.Folders().Create(ctx, domain.NewID(), "Relative")
			if err != nil {
				_ = store.Close()
				t.Fatalf("create folder: %v", err)
			}

			if err := store.Close(); err != nil {
				t.Fatalf("close store: %v", err)
			}

			if _, err := os.Stat(filepath.Join(workDir, tc.relative)); err != nil {
				t.Fatalf("database file is not at the relative path: %v", err)
			}

			entries, err := os.ReadDir(workDir)
			if err != nil {
				t.Fatalf("read work dir: %v", err)
			}

			if len(entries) != 1 || entries[0].Name() != tc.topLevel {
				t.Fatalf("work dir entries = %v, want only %q", entries, tc.topLevel)
			}

			reopened, err := Open(ctx, tc.relative)
			if err != nil {
				t.Fatalf("reopen store: %v", err)
			}

			defer reopened.Close()

			got, err := reopened.Folders().GetByID(ctx, folder.ID)
			if err != nil {
				t.Fatalf("get folder after reopen: %v", err)
			}

			if got == nil || got.Name != "Relative" {
				t.Fatalf("folder after reopen = %+v, want Relative", got)
			}
		})
	}
}

func TestPragmasApplyToEveryPooledConnection(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	var writeEnabled int
	if err := store.WriteDB().QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&writeEnabled); err != nil {
		t.Fatalf("read write pool foreign keys: %v", err)
	}

	if writeEnabled != 1 {
		t.Fatalf("write pool foreign_keys = %d, want 1", writeEnabled)
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		checked int
	)
	errs := make(chan error, readPoolConnections*2)
	for i := 0; i < readPoolConnections*2; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			conn, err := store.ReadDB().Conn(ctx)
			if err != nil {
				errs <- err

				return
			}

			defer conn.Close()

			var enabled int
			if err := conn.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&enabled); err != nil {
				errs <- err

				return
			}

			if enabled != 1 {
				errs <- fmt.Errorf("foreign_keys = %d, want 1", enabled)

				return
			}

			var busyTimeout int
			if err := conn.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
				errs <- err

				return
			}

			if busyTimeout != 5000 {
				errs <- fmt.Errorf("busy_timeout = %d, want 5000", busyTimeout)

				return
			}

			mu.Lock()
			checked++
			mu.Unlock()
		}()
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Fatalf("pooled connection pragma: %v", err)
	}

	if checked != readPoolConnections*2 {
		t.Fatalf("checked %d connections, want %d", checked, readPoolConnections*2)
	}

	_, err := store.WriteDB().ExecContext(
		ctx,
		`INSERT INTO feed (id, url, title, folder_id) VALUES (?, ?, ?, ?)`,
		domain.NewID(),
		"https://example.com/orphan.xml",
		"orphan",
		"missing-folder",
	)
	if err == nil {
		t.Fatal("expected a foreign key violation for an unknown folder")
	}
}

func TestFolderRepoLifecycle(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Folders()

	created, err := repo.Create(ctx, domain.NewID(), "  News  ")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}

	if created.Name != "News" {
		t.Fatalf("created folder name = %q, want %q", created.Name, "News")
	}

	if _, err := repo.Create(ctx, domain.NewID(), "News"); err == nil {
		t.Fatal("expected a duplicate folder name error")
	} else {
		requireCode(t, err, domain.ErrFolderAlreadyExists)
	}

	if _, err := repo.Create(ctx, domain.NewID(), "   "); err == nil {
		t.Fatal("expected an invalid folder name error")
	} else {
		requireCode(t, err, domain.ErrInvalidFolderName)
	}

	for _, name := range []string{"beta", "Alpha", "alpha"} {
		if _, err := repo.Create(ctx, domain.NewID(), name); err != nil {
			t.Fatalf("create folder %q: %v", name, err)
		}
	}

	folders, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	names := make([]string, len(folders))
	for i, folder := range folders {
		names[i] = folder.Name
	}

	if want := []string{"Alpha", "News", "alpha", "beta"}; !slices.Equal(names, want) {
		t.Fatalf("folder names = %v, want %v", names, want)
	}

	missing, err := repo.GetByID(ctx, "missing")
	if err != nil {
		t.Fatalf("get missing folder: %v", err)
	}

	if missing != nil {
		t.Fatalf("missing folder = %+v, want nil", missing)
	}

	fetched, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("get folder: %v", err)
	}

	if fetched == nil || fetched.Name != "News" {
		t.Fatalf("fetched folder = %+v, want News", fetched)
	}
}

func TestFolderRepoRename(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Folders()

	first, err := repo.Create(ctx, domain.NewID(), "News")
	if err != nil {
		t.Fatalf("create first folder: %v", err)
	}

	second, err := repo.Create(ctx, domain.NewID(), "Tech")
	if err != nil {
		t.Fatalf("create second folder: %v", err)
	}

	if err := repo.Rename(ctx, first.ID, " News "); err != nil {
		t.Fatalf("rename to the current name: %v", err)
	}

	if err := repo.Rename(ctx, "missing", "Anything"); err == nil {
		t.Fatal("expected a missing folder error")
	} else {
		requireCode(t, err, domain.ErrFolderNotFound)
	}

	if err := repo.Rename(ctx, second.ID, "News"); err == nil {
		t.Fatal("expected a duplicate folder name error")
	} else {
		requireCode(t, err, domain.ErrFolderAlreadyExists)
	}

	if err := repo.Rename(ctx, second.ID, "  Technology  "); err != nil {
		t.Fatalf("rename folder: %v", err)
	}

	renamed, err := repo.GetByID(ctx, second.ID)
	if err != nil {
		t.Fatalf("get renamed folder: %v", err)
	}

	if renamed == nil || renamed.Name != "Technology" {
		t.Fatalf("renamed folder = %+v, want Technology", renamed)
	}
}

func TestFolderRepoDeleteKeepsFeedsAtTopLevel(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	feed := createFeed(t, store, "Example", &folder.ID)
	items := addItems(t, store, feed, 2)

	if err := store.Folders().Delete(ctx, folder.ID); err != nil {
		t.Fatalf("delete folder: %v", err)
	}

	if err := store.Folders().Delete(ctx, folder.ID); err != nil {
		t.Fatalf("delete missing folder: %v", err)
	}

	deleted, err := store.Folders().GetByID(ctx, folder.ID)
	if err != nil {
		t.Fatalf("get deleted folder: %v", err)
	}

	if deleted != nil {
		t.Fatalf("deleted folder = %+v, want nil", deleted)
	}

	moved, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get feed after folder delete: %v", err)
	}

	if moved == nil {
		t.Fatal("feed was deleted with its folder")
	}

	if moved.FolderID != nil {
		t.Fatalf("feed folder = %v, want nil", *moved.FolderID)
	}

	stored, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list feed items after folder delete: %v", err)
	}

	if len(stored.Items) != len(items) {
		t.Fatalf("feed items after folder delete = %d, want %d", len(stored.Items), len(items))
	}
}

func TestFeedRepoCreate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	created, err := store.Feeds().Create(ctx, domain.Feed{
		ID:    domain.NewID(),
		URL:   mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title: "Example",
	})
	if err != nil {
		t.Fatalf("create feed: %v", err)
	}

	if created.ReaderMode != domain.ReaderModeDefault || created.Order != domain.SortOrderNewest {
		t.Fatalf("created feed defaults = %+v", created)
	}

	if created.FolderID != nil || created.UpdatedAt != nil || created.LastError != nil || created.FailureCount != 0 {
		t.Fatalf("created feed carries unexpected values: %+v", created)
	}

	username, password, ok := created.URL.BasicAuth()
	if !ok || username != "user" || password != "secret" {
		t.Fatalf("stored credentials = %q/%q/%v, want user/secret/true", username, password, ok)
	}

	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID:    domain.NewID(),
		URL:   mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title: "Duplicate",
	})
	conflict := requireCode(t, err, domain.ErrFeedAlreadyExists)
	if conflict.URL != "https://example.com/feed.xml" {
		t.Fatalf("conflict url = %q, want %q", conflict.URL, "https://example.com/feed.xml")
	}

	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("conflict error leaks credentials: %v", err)
	}

	missingFolder := "missing-folder"
	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID:       domain.NewID(),
		URL:      mustURL(t, "https://example.com/other.xml"),
		Title:    "Other",
		FolderID: &missingFolder,
	})
	requireCode(t, err, domain.ErrFolderNotFound)
}

func TestFeedRepoLookupAndList(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	for _, title := range []string{"beta", "Alpha", "alpha"} {
		createFeed(t, store, title, nil)
	}

	folder := createFolder(t, store, "News")
	folderFeed, err := store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://example.com/folder-feed.xml"),
		Title:      "Folder Feed",
		FolderID:   &folder.ID,
		ReaderMode: domain.ReaderModeExtracted,
		Order:      domain.SortOrderOldest,
	})
	if err != nil {
		t.Fatalf("create folder feed: %v", err)
	}

	if folderFeed.ReaderMode != domain.ReaderModeExtracted || folderFeed.Order != domain.SortOrderOldest {
		t.Fatalf("folder feed = %+v", folderFeed)
	}

	if folderFeed.FolderID == nil || *folderFeed.FolderID != folder.ID {
		t.Fatalf("folder feed folder = %v, want %s", folderFeed.FolderID, folder.ID)
	}

	feeds, err := store.Feeds().List(ctx)
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}

	titles := make([]string, len(feeds))
	for i, feed := range feeds {
		titles[i] = feed.Title
	}

	if want := []string{"Alpha", "Folder Feed", "alpha", "beta"}; !slices.Equal(titles, want) {
		t.Fatalf("feed titles = %v, want %v", titles, want)
	}

	byURL, err := store.Feeds().GetByURL(ctx, folderFeed.URL)
	if err != nil {
		t.Fatalf("get feed by url: %v", err)
	}

	if byURL == nil || byURL.ID != folderFeed.ID {
		t.Fatalf("feed by url = %+v, want %s", byURL, folderFeed.ID)
	}

	unknown, err := store.Feeds().GetByURL(ctx, mustURL(t, "https://example.com/unknown.xml"))
	if err != nil {
		t.Fatalf("get unknown feed by url: %v", err)
	}

	if unknown != nil {
		t.Fatalf("unknown feed = %+v, want nil", unknown)
	}

	missing, err := store.Feeds().GetByID(ctx, "missing")
	if err != nil {
		t.Fatalf("get missing feed: %v", err)
	}

	if missing != nil {
		t.Fatalf("missing feed = %+v, want nil", missing)
	}
}

func TestFeedRepoMutations(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	feed := createFeed(t, store, "Example", nil)

	if err := store.Feeds().UpdateReaderMode(ctx, feed.ID, domain.ReaderModeEmbedded); err != nil {
		t.Fatalf("update reader mode: %v", err)
	}

	if err := store.Feeds().UpdateOrder(ctx, feed.ID, domain.SortOrderOldest); err != nil {
		t.Fatalf("update order: %v", err)
	}

	if err := store.Feeds().MoveToFolder(ctx, feed.ID, &folder.ID); err != nil {
		t.Fatalf("move feed into folder: %v", err)
	}

	updated, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get updated feed: %v", err)
	}

	if updated.ReaderMode != domain.ReaderModeEmbedded || updated.Order != domain.SortOrderOldest {
		t.Fatalf("updated feed = %+v", updated)
	}

	if updated.FolderID == nil || *updated.FolderID != folder.ID {
		t.Fatalf("updated feed folder = %v, want %s", updated.FolderID, folder.ID)
	}

	missingFolder := "missing-folder"
	if err := store.Feeds().MoveToFolder(ctx, feed.ID, &missingFolder); err == nil {
		t.Fatal("expected a missing folder error")
	} else {
		requireCode(t, err, domain.ErrFolderNotFound)
	}

	if err := store.Feeds().MoveToFolder(ctx, feed.ID, nil); err != nil {
		t.Fatalf("move feed to top level: %v", err)
	}

	topLevel, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get top level feed: %v", err)
	}

	if topLevel.FolderID != nil {
		t.Fatalf("top level feed folder = %v, want nil", *topLevel.FolderID)
	}

	failure := "refresh failed for https://user:secret@example.com/feed.xml"
	if err := store.Feeds().RecordRefreshFailure(ctx, feed.ID, failure); err != nil {
		t.Fatalf("record refresh failure: %v", err)
	}

	if err := store.Feeds().RecordRefreshFailure(ctx, feed.ID, failure); err != nil {
		t.Fatalf("record second refresh failure: %v", err)
	}

	failed, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get failed feed: %v", err)
	}

	if failed.FailureCount != 2 {
		t.Fatalf("failure count = %d, want 2", failed.FailureCount)
	}

	if failed.LastError == nil || *failed.LastError != "refresh failed for https://example.com/feed.xml" {
		t.Fatalf("last error = %v", failed.LastError)
	}
}

func TestFeedRepoApplySync(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	if err := store.Feeds().RecordRefreshFailure(ctx, feed.ID, "boom"); err != nil {
		t.Fatalf("record refresh failure: %v", err)
	}

	publishedAt := time.Date(2024, 3, 1, 10, 30, 0, 0, time.UTC)
	items := []domain.FeedItem{
		{ID: domain.NewID(), URL: mustURL(t, "https://example.com/a"), Title: "A", PublishedAt: &publishedAt},
		{ID: domain.NewID(), URL: mustURL(t, "https://example.com/b"), Title: "B"},
	}

	updatedAt := time.Date(2024, 3, 1, 11, 0, 0, 0, time.UTC).In(time.FixedZone("plus-two", 2*60*60))
	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", updatedAt, items, nil); err != nil {
		t.Fatalf("apply sync: %v", err)
	}

	synced, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get synced feed: %v", err)
	}

	if synced.Title != "Synced" {
		t.Fatalf("synced title = %q, want Synced", synced.Title)
	}

	if synced.UpdatedAt == nil || !synced.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("synced updated at = %v, want %v", synced.UpdatedAt, updatedAt)
	}

	if synced.FailureCount != 0 || synced.LastError != nil {
		t.Fatalf("synced feed failure state = %d/%v, want 0/nil", synced.FailureCount, synced.LastError)
	}

	stored, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list synced items: %v", err)
	}

	if got := itemIDs(stored.Items); !slices.Equal(got, []string{items[1].ID, items[0].ID}) {
		t.Fatalf("synced item ids = %v", got)
	}

	if stored.Items[1].PublishedAt == nil || !stored.Items[1].PublishedAt.Equal(publishedAt) {
		t.Fatalf("stored published at = %v, want %v", stored.Items[1].PublishedAt, publishedAt)
	}

	duplicate := []domain.FeedItem{{ID: domain.NewID(), URL: mustURL(t, "https://example.com/a"), Title: "A again"}}
	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", updatedAt, duplicate, nil); err != nil {
		t.Fatalf("apply sync with duplicate url: %v", err)
	}

	afterDuplicate, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list items after duplicate sync: %v", err)
	}

	if len(afterDuplicate.Items) != 2 {
		t.Fatalf("items after duplicate sync = %d, want 2", len(afterDuplicate.Items))
	}

	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", updatedAt, nil, []string{items[0].ID}); err != nil {
		t.Fatalf("apply sync with deletions: %v", err)
	}

	afterDelete, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list items after deletion sync: %v", err)
	}

	if got := itemIDs(afterDelete.Items); !slices.Equal(got, []string{items[1].ID}) {
		t.Fatalf("items after deletion sync = %v", got)
	}
}

func TestFeedItemListAllPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	empty, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2})
	if err != nil {
		t.Fatalf("list empty items: %v", err)
	}

	if empty.Items == nil || len(empty.Items) != 0 || empty.Cursor != nil {
		t.Fatalf("empty page = %+v", empty)
	}

	feed := createFeed(t, store, "Example", nil)
	items := addItems(t, store, feed, 5)

	first, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2})
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}

	if got := itemIDs(first.Items); !slices.Equal(got, []string{items[4].ID, items[3].ID}) {
		t.Fatalf("first page ids = %v", got)
	}

	if first.Cursor == nil || *first.Cursor != items[3].ID {
		t.Fatalf("first page cursor = %v, want %s", first.Cursor, items[3].ID)
	}

	second, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: first.Cursor})
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}

	if got := itemIDs(second.Items); !slices.Equal(got, []string{items[2].ID, items[1].ID}) {
		t.Fatalf("second page ids = %v", got)
	}

	if second.Cursor == nil || *second.Cursor != items[1].ID {
		t.Fatalf("second page cursor = %v, want %s", second.Cursor, items[1].ID)
	}

	third, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: second.Cursor})
	if err != nil {
		t.Fatalf("list third page: %v", err)
	}

	if got := itemIDs(third.Items); !slices.Equal(got, []string{items[0].ID}) {
		t.Fatalf("third page ids = %v", got)
	}

	if third.Cursor != nil {
		t.Fatalf("third page cursor = %v, want nil", *third.Cursor)
	}

	if err := store.FeedItems().SetRead(ctx, items[4].ID, true); err != nil {
		t.Fatalf("mark item read: %v", err)
	}

	if err := store.FeedItems().SetRead(ctx, items[2].ID, true); err != nil {
		t.Fatalf("mark item read: %v", err)
	}

	unread, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 10, Unread: true})
	if err != nil {
		t.Fatalf("list unread items: %v", err)
	}

	if got := itemIDs(unread.Items); !slices.Equal(got, []string{items[3].ID, items[1].ID, items[0].ID}) {
		t.Fatalf("unread item ids = %v", got)
	}
}

func TestFeedItemListByFeedPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)
	items := addItems(t, store, feed, 5)

	newest, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 2})
	if err != nil {
		t.Fatalf("list newest page: %v", err)
	}

	if got := itemIDs(newest.Items); !slices.Equal(got, []string{items[4].ID, items[3].ID}) {
		t.Fatalf("newest page ids = %v", got)
	}

	oldest, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 2, Order: domain.SortOrderOldest})
	if err != nil {
		t.Fatalf("list oldest page: %v", err)
	}

	if got := itemIDs(oldest.Items); !slices.Equal(got, []string{items[0].ID, items[1].ID}) {
		t.Fatalf("oldest page ids = %v", got)
	}

	if oldest.Cursor == nil || *oldest.Cursor != items[1].ID {
		t.Fatalf("oldest page cursor = %v, want %s", oldest.Cursor, items[1].ID)
	}

	oldestNext, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{
		Limit:  2,
		Order:  domain.SortOrderOldest,
		Cursor: oldest.Cursor,
	})
	if err != nil {
		t.Fatalf("list oldest second page: %v", err)
	}

	if got := itemIDs(oldestNext.Items); !slices.Equal(got, []string{items[2].ID, items[3].ID}) {
		t.Fatalf("oldest second page ids = %v", got)
	}

	if err := store.FeedItems().SetRead(ctx, items[3].ID, true); err != nil {
		t.Fatalf("mark item read: %v", err)
	}

	unread, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Unread: true})
	if err != nil {
		t.Fatalf("list unread feed items: %v", err)
	}

	if got := itemIDs(unread.Items); !slices.Equal(got, []string{items[4].ID, items[2].ID, items[1].ID, items[0].ID}) {
		t.Fatalf("unread feed item ids = %v", got)
	}

	unknown, err := store.FeedItems().ListByFeed(ctx, "missing", domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list unknown feed items: %v", err)
	}

	if unknown.Items == nil || len(unknown.Items) != 0 || unknown.Cursor != nil {
		t.Fatalf("unknown feed page = %+v", unknown)
	}
}

func TestFeedItemListByFolder(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	first := createFeed(t, store, "First", &folder.ID)
	second := createFeed(t, store, "Second", &folder.ID)
	outside := createFeed(t, store, "Outside", nil)

	firstItems := addItems(t, store, first, 2)
	secondItems := addItems(t, store, second, 2)
	outsideItems := addItems(t, store, outside, 1)

	firstPage, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 3})
	if err != nil {
		t.Fatalf("list folder page: %v", err)
	}

	want := []string{secondItems[1].ID, secondItems[0].ID, firstItems[1].ID}
	if got := itemIDs(firstPage.Items); !slices.Equal(got, want) {
		t.Fatalf("folder page ids = %v, want %v", got, want)
	}

	if firstPage.Cursor == nil || *firstPage.Cursor != firstItems[1].ID {
		t.Fatalf("folder page cursor = %v, want %s", firstPage.Cursor, firstItems[1].ID)
	}

	nextPage, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 3, Cursor: firstPage.Cursor})
	if err != nil {
		t.Fatalf("list folder next page: %v", err)
	}

	if got := itemIDs(nextPage.Items); !slices.Equal(got, []string{firstItems[0].ID}) {
		t.Fatalf("folder next page ids = %v", got)
	}

	if slices.Contains(itemIDs(nextPage.Items), outsideItems[0].ID) {
		t.Fatal("folder page includes an item from outside the folder")
	}

	if err := store.FeedItems().SetRead(ctx, secondItems[0].ID, true); err != nil {
		t.Fatalf("mark folder item read: %v", err)
	}

	unread, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 10, Unread: true})
	if err != nil {
		t.Fatalf("list unread folder items: %v", err)
	}

	if got := itemIDs(unread.Items); !slices.Equal(got, []string{secondItems[1].ID, firstItems[1].ID, firstItems[0].ID}) {
		t.Fatalf("unread folder item ids = %v", got)
	}

	missing, err := store.FeedItems().ListByFolder(ctx, "missing", domain.PageParams{Limit: 10})
	if err != nil {
		t.Fatalf("list unknown folder items: %v", err)
	}

	if missing.Items == nil || len(missing.Items) != 0 || missing.Cursor != nil {
		t.Fatalf("unknown folder page = %+v", missing)
	}
}

func TestFeedItemUnreadCountsAndMarking(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	first := createFeed(t, store, "First", &folder.ID)
	second := createFeed(t, store, "Second", &folder.ID)
	outside := createFeed(t, store, "Outside", nil)

	firstItems := addItems(t, store, first, 3)
	addItems(t, store, second, 1)
	outsideItems := addItems(t, store, outside, 2)

	counts, err := store.FeedItems().UnreadCounts(ctx)
	if err != nil {
		t.Fatalf("unread counts: %v", err)
	}

	if got := unreadCountMap(counts); len(got) != 3 || got[first.ID] != 3 || got[second.ID] != 1 || got[outside.ID] != 2 {
		t.Fatalf("unread counts = %v", got)
	}

	if err := store.FeedItems().MarkIDsRead(ctx, []string{firstItems[0].ID, "missing"}); err != nil {
		t.Fatalf("mark ids read: %v", err)
	}

	if err := store.FeedItems().MarkIDsRead(ctx, nil); err != nil {
		t.Fatalf("mark empty ids read: %v", err)
	}

	marked, err := store.FeedItems().GetByID(ctx, firstItems[0].ID)
	if err != nil {
		t.Fatalf("get marked item: %v", err)
	}

	if marked == nil || !marked.Read {
		t.Fatalf("marked item = %+v, want read", marked)
	}

	if err := store.FeedItems().MarkFeedRead(ctx, first.ID); err != nil {
		t.Fatalf("mark feed read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx)
	if err != nil {
		t.Fatalf("unread counts after feed mark: %v", err)
	}

	if got := unreadCountMap(counts); got[first.ID] != 0 || got[second.ID] != 1 || got[outside.ID] != 2 {
		t.Fatalf("unread counts after feed mark = %v", got)
	}

	if err := store.FeedItems().MarkFolderRead(ctx, folder.ID); err != nil {
		t.Fatalf("mark folder read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx)
	if err != nil {
		t.Fatalf("unread counts after folder mark: %v", err)
	}

	if got := unreadCountMap(counts); got[first.ID] != 0 || got[second.ID] != 0 || got[outside.ID] != 2 {
		t.Fatalf("unread counts after folder mark = %v", got)
	}

	if err := store.FeedItems().MarkAllRead(ctx); err != nil {
		t.Fatalf("mark all read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx)
	if err != nil {
		t.Fatalf("unread counts after mark all: %v", err)
	}

	if len(counts) != 0 {
		t.Fatalf("unread counts after mark all = %v, want empty", counts)
	}

	if err := store.FeedItems().SetRead(ctx, outsideItems[0].ID, false); err != nil {
		t.Fatalf("mark item unread: %v", err)
	}

	unread, err := store.FeedItems().GetByID(ctx, outsideItems[0].ID)
	if err != nil {
		t.Fatalf("get unread item: %v", err)
	}

	if unread == nil || unread.Read {
		t.Fatalf("unread item = %+v, want unread", unread)
	}

	if err := store.FeedItems().SetRead(ctx, "missing", true); err != nil {
		t.Fatalf("mark missing item read: %v", err)
	}
}

func TestFeedItemSaveExtractedContentIfEmpty(t *testing.T) {
	// Emptiness follows strings.TrimSpace (Unicode White_Space), not SQLite trim().
	cases := []struct {
		name      string
		existing  *string
		wantWrote bool
	}{
		{name: "null", existing: nil, wantWrote: true},
		{name: "empty", existing: ptr(""), wantWrote: true},
		{name: "spaces", existing: ptr("   "), wantWrote: true},
		{name: "tab and newline", existing: ptr("\t\r\n"), wantWrote: true},
		{name: "vertical tab and form feed", existing: ptr("\v\f"), wantWrote: true},
		{name: "next line", existing: ptr("\u0085"), wantWrote: true},
		{name: "no-break space", existing: ptr("\u00a0"), wantWrote: true},
		{name: "em space and line separator", existing: ptr("\u2003\u2028\u2029"), wantWrote: true},
		{name: "ideographic space", existing: ptr("\u3000 \n"), wantWrote: true},
		{name: "text", existing: ptr("<p>first</p>"), wantWrote: false},
		{name: "text with surrounding whitespace", existing: ptr("\n <p>first</p>\t"), wantWrote: false},
		{name: "zero-width space is not whitespace", existing: ptr("\u200b"), wantWrote: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t)
			ctx := context.Background()
			feed := createFeed(t, store, "Example", nil)
			item := domain.FeedItem{
				ID:               domain.NewID(),
				FeedID:           feed.ID,
				URL:              mustURL(t, "https://example.com/items/"+domain.NewID()),
				Title:            "Item",
				ExtractedContent: tc.existing,
			}

			if err := store.Feeds().ApplySync(ctx, feed.ID, feed.Title, time.Now().UTC(), []domain.FeedItem{item}, nil); err != nil {
				t.Fatalf("seed item: %v", err)
			}

			if err := store.FeedItems().SetRead(ctx, item.ID, true); err != nil {
				t.Fatalf("mark item read: %v", err)
			}

			const incoming = "<p>incoming</p>"

			result, wrote, err := store.FeedItems().SaveExtractedContentIfEmpty(ctx, item.ID, incoming)
			if err != nil {
				t.Fatalf("SaveExtractedContentIfEmpty: %v", err)
			}

			want := incoming
			if !tc.wantWrote {
				want = *tc.existing
			}

			if wrote != tc.wantWrote {
				t.Fatalf("wrote = %v, want %v", wrote, tc.wantWrote)
			}

			if result == nil || result.ExtractedContent == nil || *result.ExtractedContent != want {
				t.Fatalf("returned content = %v, want %q", result, want)
			}

			if !result.Read || result.ID != item.ID {
				t.Fatalf("returned item = %+v, want same read item", result)
			}

			stored, err := store.FeedItems().GetByID(ctx, item.ID)
			if err != nil {
				t.Fatalf("get item: %v", err)
			}

			if stored == nil || stored.ExtractedContent == nil || *stored.ExtractedContent != want {
				t.Fatalf("stored content = %v, want %q", stored, want)
			}
		})
	}
}

func TestFeedItemSaveExtractedContentIfEmptyMissingItem(t *testing.T) {
	store := newTestStore(t)

	_, wrote, err := store.FeedItems().SaveExtractedContentIfEmpty(context.Background(), "missing", "<p>x</p>")
	if err == nil {
		t.Fatal("expected a missing feed item error")
	}

	requireCode(t, err, domain.ErrFeedItemNotFound)

	if wrote {
		t.Fatal("wrote = true for a missing item")
	}
}

func TestFeedItemSaveExtractedContentIfEmptyConcurrentWritersAgree(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)
	items := addItems(t, store, feed, 1)

	const writers = 8

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		winners int
		seen    = make(map[string]struct{})
	)

	for i := range writers {
		wg.Add(1)

		go func() {
			defer wg.Done()

			result, wrote, err := store.FeedItems().SaveExtractedContentIfEmpty(ctx, items[0].ID, fmt.Sprintf("<p>writer %d</p>", i))
			if err != nil {
				t.Errorf("writer %d: %v", i, err)

				return
			}

			mu.Lock()
			defer mu.Unlock()

			if wrote {
				winners++
			}

			seen[*result.ExtractedContent] = struct{}{}
		}()
	}

	wg.Wait()

	if winners != 1 {
		t.Fatalf("winning writers = %d, want 1", winners)
	}

	if len(seen) != 1 {
		t.Fatalf("writers observed %d distinct contents, want 1: %v", len(seen), seen)
	}
}

func TestStoreExportOPML(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	tech, err := store.Folders().Create(ctx, domain.NewID(), "Tech")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	emptyFolder, err := store.Folders().Create(ctx, domain.NewID(), "Empty")
	if err != nil {
		t.Fatalf("create empty folder: %v", err)
	}

	top := createFeed(t, store, "Top Feed", nil)
	inTech := createFeed(t, store, "Tech Feed", &tech.ID)

	folders, topFeeds, err := store.Feeds().ExportOPML(ctx)
	if err != nil {
		t.Fatalf("export opml: %v", err)
	}

	if len(topFeeds) != 1 || topFeeds[0].ID != top.ID {
		t.Fatalf("topFeeds = %+v, want [%s]", topFeeds, top.ID)
	}

	if len(folders) != 2 || folders[0].Name != emptyFolder.Name || len(folders[0].Feeds) != 0 {
		t.Fatalf("folders[0] = %+v", folders)
	}

	if folders[1].Name != tech.Name || len(folders[1].Feeds) != 1 || folders[1].Feeds[0].ID != inTech.ID {
		t.Fatalf("folders[1] = %+v", folders[1])
	}
}

func TestFeedItemStoredRefsAndRetention(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	items := []domain.FeedItem{
		{ID: domain.NewID(), URL: mustURL(t, "https://example.com/first"), Title: "First"},
		{ID: domain.NewID(), URL: mustURL(t, "https://user:secret@example.com/second"), Title: "Second"},
	}
	if err := store.Feeds().ApplySync(ctx, feed.ID, "Example", time.Now().UTC(), items, nil); err != nil {
		t.Fatalf("apply sync: %v", err)
	}

	refs, err := store.FeedItems().ListStoredRefsByFeed(ctx, feed.ID)
	if err != nil {
		t.Fatalf("list stored refs: %v", err)
	}

	if len(refs) != 2 {
		t.Fatalf("stored refs = %d, want 2", len(refs))
	}

	if refs[0].ID != items[1].ID || refs[0].URL.Raw() != items[1].URL.Raw() {
		t.Fatalf("first stored ref = %+v", refs[0])
	}

	if refs[1].ID != items[0].ID || refs[1].URL.Raw() != items[0].URL.Raw() {
		t.Fatalf("second stored ref = %+v", refs[1])
	}

	if !refs[0].URL.HasCredentials() {
		t.Fatal("stored ref lost its credentials")
	}

	if err := store.Feeds().Delete(ctx, feed.ID); err != nil {
		t.Fatalf("delete feed: %v", err)
	}

	remaining, err := store.FeedItems().ListStoredRefsByFeed(ctx, feed.ID)
	if err != nil {
		t.Fatalf("list stored refs after delete: %v", err)
	}

	if len(remaining) != 0 {
		t.Fatalf("stored refs after delete = %d, want 0", len(remaining))
	}
}

func TestRejectsMalformedStoredURLs(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	badFeedID := domain.NewID()
	badFeedURL := "not-a-valid-url-secretfeedmarker"
	if _, err := store.WriteDB().ExecContext(
		ctx,
		`INSERT INTO feed (id, url, title) VALUES (?, ?, 'Broken Feed')`,
		badFeedID,
		badFeedURL,
	); err != nil {
		t.Fatalf("insert malformed feed: %v", err)
	}

	if _, err := store.Feeds().GetByID(ctx, badFeedID); err == nil {
		t.Fatal("Feeds().GetByID() error = nil, want repository error")
	} else {
		requireCode(t, err, domain.ErrFeedRepositoryError)
		if strings.Contains(err.Error(), "secretfeedmarker") {
			t.Fatalf("Feeds().GetByID() error leaked stored text: %v", err)
		}
	}

	if _, err := store.Feeds().List(ctx); err == nil {
		t.Fatal("Feeds().List() error = nil, want repository error")
	} else {
		requireCode(t, err, domain.ErrFeedRepositoryError)
		if strings.Contains(err.Error(), "secretfeedmarker") {
			t.Fatalf("Feeds().List() error leaked stored text: %v", err)
		}
	}

	validFeed := createFeed(t, store, "Valid Feed", nil)
	badItemID := domain.NewID()
	badItemURL := "ftp://secretitemmarker.example/item"
	if _, err := store.WriteDB().ExecContext(
		ctx,
		`INSERT INTO feed_item (id, feed_id, url, title) VALUES (?, ?, ?, 'Broken Item')`,
		badItemID,
		validFeed.ID,
		badItemURL,
	); err != nil {
		t.Fatalf("insert malformed feed item: %v", err)
	}

	if _, err := store.FeedItems().GetByID(ctx, badItemID); err == nil {
		t.Fatal("FeedItems().GetByID() error = nil, want repository error")
	} else {
		requireCode(t, err, domain.ErrFeedItemRepositoryError)
		if strings.Contains(err.Error(), "secretitemmarker") {
			t.Fatalf("FeedItems().GetByID() error leaked stored text: %v", err)
		}
	}

	if _, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 10}); err == nil {
		t.Fatal("FeedItems().ListAll() error = nil, want repository error")
	} else {
		requireCode(t, err, domain.ErrFeedItemRepositoryError)
		if strings.Contains(err.Error(), "secretitemmarker") {
			t.Fatalf("FeedItems().ListAll() error leaked stored text: %v", err)
		}
	}

	if _, err := store.FeedItems().ListStoredRefsByFeed(ctx, validFeed.ID); err == nil {
		t.Fatal("FeedItems().ListStoredRefsByFeed() error = nil, want repository error")
	} else {
		requireCode(t, err, domain.ErrFeedItemRepositoryError)
		if strings.Contains(err.Error(), "secretitemmarker") {
			t.Fatalf("FeedItems().ListStoredRefsByFeed() error leaked stored text: %v", err)
		}
	}
}

func TestStoreImportOPML(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	tech := createFolder(t, store, "Tech")
	existing := createFeed(t, store, "Existing", &tech.ID)

	doc := domain.OPMLDocument{
		Folders: []string{"News", "Tech", "  News  "},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/news-1"), Title: "News 1", FolderName: ptr(" News ")},
			{URL: mustURL(t, "https://example.com/news-2"), Title: "News 2", FolderName: ptr("News")},
			{URL: mustURL(t, "https://example.com/top"), Title: "Top"},
			{URL: existing.URL, Title: "Existing"},
			{URL: mustURL(t, "https://example.com/tech-1"), Title: "Tech 1", FolderName: ptr("Tech")},
		},
		SkippedInvalid: 2,
	}

	result, createdIDs, err := store.Feeds().ImportOPML(ctx, doc)
	if err != nil {
		t.Fatalf("import opml: %v", err)
	}

	if result.CreatedFolders != 1 {
		t.Fatalf("created folders = %d, want 1", result.CreatedFolders)
	}

	if result.ImportedFeeds != 4 {
		t.Fatalf("imported feeds = %d, want 4", result.ImportedFeeds)
	}

	if result.SkippedFeeds != 3 {
		t.Fatalf("skipped feeds = %d, want 3", result.SkippedFeeds)
	}

	if len(createdIDs) != 4 {
		t.Fatalf("created feed ids = %d, want 4", len(createdIDs))
	}

	newsFolderID := folderIDByName(t, store, "News")
	createdTitles := make([]string, len(createdIDs))
	for i, id := range createdIDs {
		feed, err := store.Feeds().GetByID(ctx, id)
		if err != nil || feed == nil {
			t.Fatalf("get created feed %q: (%v, %v)", id, feed, err)
		}

		createdTitles[i] = feed.Title
		if feed.ReaderMode != domain.ReaderModeDefault || feed.Order != domain.SortOrderNewest {
			t.Fatalf("created feed defaults = %+v", feed)
		}

		if i == 0 && (feed.FolderID == nil || *feed.FolderID != newsFolderID) {
			t.Fatalf("news feed folder = %v, want %s", feed.FolderID, newsFolderID)
		}

		if i == 2 && feed.FolderID != nil {
			t.Fatalf("top level feed folder = %v, want nil", *feed.FolderID)
		}
	}

	if want := []string{"News 1", "News 2", "Top", "Tech 1"}; !slices.Equal(createdTitles, want) {
		t.Fatalf("created feed titles = %v, want %v", createdTitles, want)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	if len(folders) != 2 {
		t.Fatalf("folders after import = %d, want 2", len(folders))
	}

	repoResult, repoIDs, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Folders: []string{"Later"},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/later-1"), Title: "Later 1", FolderName: ptr("Later")},
			{URL: mustURL(t, "https://example.com/top"), Title: "Top duplicate"},
		},
	})
	if err != nil {
		t.Fatalf("import opml through feed repo: %v", err)
	}

	if repoResult.ImportedFeeds != 1 || repoResult.SkippedFeeds != 1 || repoResult.CreatedFolders != 1 {
		t.Fatalf("feed repo import result = %+v", repoResult)
	}

	if len(repoIDs) != 1 {
		t.Fatalf("feed repo imported ids = %v, want one", repoIDs)
	}

	imported, err := store.Feeds().GetByID(ctx, repoIDs[0])
	if err != nil {
		t.Fatalf("get imported feed: %v", err)
	}

	if imported == nil || imported.Title != "Later 1" {
		t.Fatalf("imported feed = %+v", imported)
	}
}

func TestImportOPMLIsAtomic(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	doc := domain.OPMLDocument{
		Folders: []string{"Atomic"},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/atomic-1"), Title: "Atomic 1", FolderName: ptr("Atomic")},
			{URL: mustURL(t, "https://example.com/atomic-2"), Title: "Atomic 2", FolderName: ptr("   ")},
		},
	}

	if _, _, err := store.Feeds().ImportOPML(ctx, doc); err == nil {
		t.Fatal("expected the import to fail")
	} else {
		requireCode(t, err, domain.ErrInvalidFolderName)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders after failed import: %v", err)
	}

	if len(folders) != 0 {
		t.Fatalf("folders after failed import = %v, want none", folders)
	}

	feeds, err := store.Feeds().List(ctx)
	if err != nil {
		t.Fatalf("list feeds after failed import: %v", err)
	}

	if len(feeds) != 0 {
		t.Fatalf("feeds after failed import = %v, want none", feeds)
	}
}

func TestSavedPageRepoCreateAndLookup(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	publishedAt := time.Date(2024, 2, 2, 9, 0, 0, 0, time.UTC)
	page := domain.SavedPage{
		ID:          domain.NewID(),
		URL:         mustURL(t, "https://user:secret@example.com/article"),
		Title:       "Article",
		Description: ptr("summary"),
		Content:     "<p>body</p>",
		PublishedAt: &publishedAt,
	}

	created, err := store.SavedPages().Create(ctx, page)
	if err != nil {
		t.Fatalf("create saved page: %v", err)
	}

	if created.Read || created.Title != "Article" || created.Content != "<p>body</p>" {
		t.Fatalf("created saved page = %+v", created)
	}

	if created.Description == nil || *created.Description != "summary" {
		t.Fatalf("created description = %v", created.Description)
	}

	if created.PublishedAt == nil || !created.PublishedAt.Equal(publishedAt) {
		t.Fatalf("created published at = %v, want %v", created.PublishedAt, publishedAt)
	}

	_, err = store.SavedPages().Create(ctx, domain.SavedPage{
		ID:      domain.NewID(),
		URL:     page.URL,
		Title:   "Duplicate",
		Content: "<p>body</p>",
	})
	conflict := requireCode(t, err, domain.ErrSavedPageAlreadyExists)
	if conflict.ID != page.ID {
		t.Fatalf("conflict id = %q, want %q", conflict.ID, page.ID)
	}

	if conflict.URL != "https://example.com/article" {
		t.Fatalf("conflict url = %q, want %q", conflict.URL, "https://example.com/article")
	}

	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("conflict error leaks credentials: %v", err)
	}

	byURL, err := store.SavedPages().GetByURL(ctx, page.URL)
	if err != nil {
		t.Fatalf("get saved page by url: %v", err)
	}

	if byURL == nil || byURL.ID != page.ID {
		t.Fatalf("saved page by url = %+v, want %s", byURL, page.ID)
	}

	if _, err := store.SavedPages().GetByURL(ctx, mustURL(t, "https://example.com/unknown")); err != nil {
		t.Fatalf("get unknown saved page by url: %v", err)
	}

	missing, err := store.SavedPages().GetByID(ctx, "missing")
	if err != nil {
		t.Fatalf("get missing saved page: %v", err)
	}

	if missing != nil {
		t.Fatalf("missing saved page = %+v, want nil", missing)
	}
}

func TestSavedPageRepoListPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	empty, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2})
	if err != nil {
		t.Fatalf("list empty saved pages: %v", err)
	}

	if empty.Items == nil || len(empty.Items) != 0 || empty.Cursor != nil {
		t.Fatalf("empty saved page list = %+v", empty)
	}

	pages := make([]domain.SavedPage, 5)
	for i := range pages {
		created, err := store.SavedPages().Create(ctx, domain.SavedPage{
			ID:      domain.NewID(),
			URL:     mustURL(t, "https://example.com/pages/"+domain.NewID()),
			Title:   fmt.Sprintf("Page %d", i),
			Content: "<p>body</p>",
		})
		if err != nil {
			t.Fatalf("create saved page: %v", err)
		}

		pages[i] = created
	}

	first, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2})
	if err != nil {
		t.Fatalf("list first saved page page: %v", err)
	}

	if got := savedPageIDs(first.Items); !slices.Equal(got, []string{pages[4].ID, pages[3].ID}) {
		t.Fatalf("first saved page ids = %v", got)
	}

	if first.Cursor == nil || *first.Cursor != pages[3].ID {
		t.Fatalf("first saved page cursor = %v, want %s", first.Cursor, pages[3].ID)
	}

	second, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: first.Cursor})
	if err != nil {
		t.Fatalf("list second saved page page: %v", err)
	}

	if got := savedPageIDs(second.Items); !slices.Equal(got, []string{pages[2].ID, pages[1].ID}) {
		t.Fatalf("second saved page ids = %v", got)
	}

	third, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: second.Cursor})
	if err != nil {
		t.Fatalf("list third saved page page: %v", err)
	}

	if got := savedPageIDs(third.Items); !slices.Equal(got, []string{pages[0].ID}) {
		t.Fatalf("third saved page ids = %v", got)
	}

	if third.Cursor != nil {
		t.Fatalf("third saved page cursor = %v, want nil", *third.Cursor)
	}

	if err := store.SavedPages().SetRead(ctx, pages[4].ID, true); err != nil {
		t.Fatalf("mark saved page read: %v", err)
	}

	if err := store.SavedPages().MarkIDsRead(ctx, []string{pages[3].ID, pages[2].ID, "missing"}); err != nil {
		t.Fatalf("mark saved page ids read: %v", err)
	}

	unread, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 10, Unread: true})
	if err != nil {
		t.Fatalf("list unread saved pages: %v", err)
	}

	if got := savedPageIDs(unread.Items); !slices.Equal(got, []string{pages[1].ID, pages[0].ID}) {
		t.Fatalf("unread saved page ids = %v", got)
	}

	unreadCount, err := store.SavedPages().UnreadCount(ctx)
	if err != nil {
		t.Fatalf("saved page unread count: %v", err)
	}

	if unreadCount != 2 {
		t.Fatalf("saved page unread count = %d, want 2", unreadCount)
	}

	if err := store.SavedPages().MarkAllRead(ctx); err != nil {
		t.Fatalf("mark all saved pages read: %v", err)
	}

	unreadCount, err = store.SavedPages().UnreadCount(ctx)
	if err != nil {
		t.Fatalf("saved page unread count after mark all: %v", err)
	}

	if unreadCount != 0 {
		t.Fatalf("saved page unread count after mark all = %d, want 0", unreadCount)
	}

	if err := store.SavedPages().Delete(ctx, pages[0].ID); err != nil {
		t.Fatalf("delete saved page: %v", err)
	}

	deleted, err := store.SavedPages().GetByID(ctx, pages[0].ID)
	if err != nil {
		t.Fatalf("get deleted saved page: %v", err)
	}

	if deleted != nil {
		t.Fatalf("deleted saved page = %+v, want nil", deleted)
	}

	if err := store.SavedPages().Delete(ctx, "missing"); err != nil {
		t.Fatalf("delete missing saved page: %v", err)
	}
}

func TestSettingRepoProvider(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Provider != domain.ProviderDirect || settings.Retention != 100 {
		t.Fatalf("default settings = %+v", settings)
	}

	if err := repo.UpdateRetention(ctx, 250); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderJina); err != nil {
		t.Fatalf("update provider jina without key: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after jina: %v", err)
	}

	if settings.Retention != 250 || settings.Provider != domain.ProviderJina || settings.JinaKey != nil {
		t.Fatalf("settings after jina = %+v", settings)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderBrowser); err == nil {
		t.Fatal("expected a required browser endpoint error")
	} else {
		requireCode(t, err, domain.ErrBrowserEndpointRequired)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after failed browser switch: %v", err)
	}

	if settings.Provider != domain.ProviderJina || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after failed browser switch = %+v", settings)
	}

	if err := repo.UpdateBrowserEndpoint(ctx, "   "); err != nil {
		t.Fatalf("update blank browser endpoint: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderBrowser); err == nil {
		t.Fatal("expected a required browser endpoint error for blank endpoint")
	} else {
		requireCode(t, err, domain.ErrBrowserEndpointRequired)
	}

	if err := repo.UpdateBrowserEndpoint(ctx, "wss://browser.internal:3000"); err != nil {
		t.Fatalf("update browser endpoint: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderBrowser); err != nil {
		t.Fatalf("update provider browser: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after browser: %v", err)
	}

	if settings.Provider != domain.ProviderBrowser || settings.BrowserEndpoint == nil || *settings.BrowserEndpoint != "wss://browser.internal:3000" {
		t.Fatalf("settings after browser = %+v", settings)
	}

	if err := repo.DeleteBrowserEndpoint(ctx); err != nil {
		t.Fatalf("delete browser endpoint while provider=browser: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting browser endpoint: %v", err)
	}

	if settings.Provider != domain.ProviderDirect || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after deleting browser endpoint = %+v", settings)
	}

	if err := repo.UpdateBrowserEndpoint(ctx, "https://browser.internal:3001"); err != nil {
		t.Fatalf("set browser endpoint again: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderJina); err != nil {
		t.Fatalf("switch provider to jina: %v", err)
	}

	if err := repo.DeleteBrowserEndpoint(ctx); err != nil {
		t.Fatalf("delete browser endpoint while provider=jina: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting browser endpoint under jina: %v", err)
	}

	if settings.Provider != domain.ProviderJina || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after deleting browser endpoint under jina = %+v", settings)
	}

	if err := repo.UpdateProvider(ctx, domain.ExtractorProvider("unknown")); err == nil {
		t.Fatal("expected an invalid provider constraint error")
	} else {
		requireCode(t, err, domain.ErrSettingRepositoryError)
	}

	if err := repo.UpdateRetention(ctx, 0); err == nil {
		t.Fatal("expected an invalid retention error")
	} else {
		requireCode(t, err, domain.ErrSettingRepositoryError)
	}
}

func TestSettingRepoServices(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	if err := repo.UpdateJinaKey(ctx, "key-1"); err != nil {
		t.Fatalf("update jina key: %v", err)
	}

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after jina key: %v", err)
	}

	if settings.JinaKey == nil || *settings.JinaKey != "key-1" {
		t.Fatalf("jina key = %v, want key-1", settings.JinaKey)
	}

	if err := repo.DeleteJinaKey(ctx); err != nil {
		t.Fatalf("delete jina key: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting jina key: %v", err)
	}

	if settings.JinaKey != nil {
		t.Fatalf("jina key after delete = %v, want nil", settings.JinaKey)
	}

	smtp := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptr("smtp-user"),
		Password:    ptr("smtp-password"),
	}

	if err := repo.UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after smtp: %v", err)
	}

	if settings.SMTP == nil {
		t.Fatal("smtp settings are missing")
	}

	if settings.Kindle != nil {
		t.Fatalf("kindle settings should be nil before UpdateKindle: %+v", settings.Kindle)
	}

	assertSMTPSettings(t, *settings.SMTP, smtp)

	smtpWithoutPassword := smtp
	smtpWithoutPassword.Password = nil
	if err := repo.UpdateSMTP(ctx, smtpWithoutPassword); err != nil {
		t.Fatalf("update smtp without password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after nil smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "smtp-password" {
		t.Fatalf("password was not preserved: %+v", settings.SMTP)
	}

	smtpWithBlankPassword := smtp
	smtpWithBlankPassword.Password = ptr("   ")
	if err := repo.UpdateSMTP(ctx, smtpWithBlankPassword); err != nil {
		t.Fatalf("update smtp with blank password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after blank smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "smtp-password" {
		t.Fatalf("password was not preserved after blank update: %+v", settings.SMTP)
	}

	rotated := smtp
	rotated.Password = ptr("rotated-password")
	if err := repo.UpdateSMTP(ctx, rotated); err != nil {
		t.Fatalf("update smtp with rotated password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after rotated smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "rotated-password" {
		t.Fatalf("rotated password = %+v", settings.SMTP)
	}

	if err := repo.DeleteSMTPPassword(ctx); err != nil {
		t.Fatalf("delete smtp password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password != nil {
		t.Fatalf("smtp password after delete = %+v", settings.SMTP)
	}

	nextSendAt := time.Date(2024, 6, 1, 8, 30, 0, 0, time.UTC)
	kindle := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		SendTime:    ptr("08:30"),
		NextSendAt:  &nextSendAt,
	}
	if err := repo.UpdateKindle(ctx, kindle); err != nil {
		t.Fatalf("update kindle before deleting smtp: %v", err)
	}

	if err := repo.DeleteSMTP(ctx); err != nil {
		t.Fatalf("delete smtp: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting smtp: %v", err)
	}

	if settings.SMTP != nil {
		t.Fatalf("smtp after delete = %+v, want nil", settings.SMTP)
	}

	if settings.Kindle == nil {
		t.Fatal("kindle settings were cleared by DeleteSMTP")
	}

	assertKindleSettings(t, *settings.Kindle, kindle)
}

func TestSettingRepoKindle(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	nextSendAt := time.Date(2024, 6, 1, 8, 30, 0, 0, time.UTC)
	kindle := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		SendTime:    ptr("08:30"),
		NextSendAt:  &nextSendAt,
	}

	if err := repo.UpdateKindle(ctx, kindle); err == nil {
		t.Fatal("expected an SMTP not configured error")
	} else {
		requireCode(t, err, domain.ErrSMTPNotConfigured)
	}

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after rejected kindle update: %v", err)
	}

	if settings.SMTP != nil || settings.Kindle != nil {
		t.Fatalf("settings after rejected kindle update = %+v", settings)
	}

	smtp := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptr("smtp-user"),
		Password:    ptr("smtp-password"),
	}
	if err := repo.UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	if err := repo.UpdateKindle(ctx, kindle); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.SMTP == nil || settings.Kindle == nil {
		t.Fatalf("expected both smtp and kindle settings, got %+v", settings)
	}

	assertSMTPSettings(t, *settings.SMTP, smtp)
	assertKindleSettings(t, *settings.Kindle, kindle)

	manualOnly := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
	}
	if err := repo.UpdateKindle(ctx, manualOnly); err != nil {
		t.Fatalf("update kindle without schedule: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after clearing schedule: %v", err)
	}

	if settings.Kindle == nil || settings.Kindle.KindleEmail != "reader@kindle.com" || settings.Kindle.SendTime != nil || settings.Kindle.NextSendAt != nil {
		t.Fatalf("manual-only kindle = %+v", settings.Kindle)
	}
}

func configureKindleDeliveryForTest(t *testing.T, store *Store, kindle domain.KindleSettings) {
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

	if err := store.Settings().UpdateKindle(ctx, kindle); err != nil {
		t.Fatalf("update kindle: %v", err)
	}
}

func TestKindleSendRepoCreateAndRecover(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	startedAt := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)
	if _, err := repo.ClaimManualSend(ctx, domain.NewID(), startedAt); err == nil {
		t.Fatal("expected KindleNotConfigured before settings exist")
	} else {
		requireCode(t, err, domain.ErrKindleNotConfigured)
	}

	dueAt := startedAt.Add(-time.Hour)
	configureKindleDeliveryForTest(t, store, domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		SendTime:    ptr("09:00"),
		NextSendAt:  &dueAt,
	})

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), startedAt)
	if err != nil {
		t.Fatalf("claim manual send: %v", err)
	}

	record := claimed.Record
	if !claimed.Claimed || record.Status != domain.KindleStatusRunning || record.ArticleCount != 0 || record.BookCount != 0 || record.FinishedAt != nil {
		t.Fatalf("claimed manual send = %+v", claimed)
	}

	if claimed.Delivery.KindleEmail != "reader@kindle.com" || claimed.Delivery.SMTP.Host != "smtp.example.com" {
		t.Fatalf("claimed delivery = %+v", claimed.Delivery)
	}

	if _, err := repo.ClaimManualSend(ctx, domain.NewID(), startedAt.Add(time.Minute)); err == nil {
		t.Fatal("expected a send in progress error")
	} else {
		requireCode(t, err, domain.ErrKindleSendInProgress)
	}

	// Scheduled claim while manual send is active must advance next_send_at and skip.
	skipped, err := repo.ClaimDueSend(ctx, domain.NewID(), startedAt.Add(time.Minute), time.UTC, false)
	if err != nil {
		t.Fatalf("claim due send while active: %v", err)
	}

	if skipped.Claimed {
		t.Fatalf("expected due send to skip while manual send is running: %+v", skipped)
	}

	settingsAfterSkip, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings after skip: %v", err)
	}

	wantNext := time.Date(2024, 5, 1, 9, 0, 0, 0, time.UTC)
	if settingsAfterSkip.Kindle == nil || settingsAfterSkip.Kindle.NextSendAt == nil || !settingsAfterSkip.Kindle.NextSendAt.Equal(wantNext) {
		t.Fatalf("next_send_at after skip = %+v, want %v", settingsAfterSkip.Kindle, wantNext)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 1 || recent[0].ID != record.ID {
		t.Fatalf("recent sends = %+v", recent)
	}

	finishedAt := startedAt.Add(2 * time.Minute)
	if err := repo.CompleteSend(ctx, record.ID, domain.KindleStatusSucceeded, nil, finishedAt); err != nil {
		t.Fatalf("complete send: %v", err)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after completion: %v", err)
	}

	if len(recent) != 1 || recent[0].Status != domain.KindleStatusSucceeded || recent[0].Error != nil {
		t.Fatalf("recent sends after completion = %+v", recent)
	}

	if recent[0].FinishedAt == nil || !recent[0].FinishedAt.Equal(finishedAt) {
		t.Fatalf("completed send finished at = %v, want %v", recent[0].FinishedAt, finishedAt)
	}

	// Now ClaimDueSend at 09:30 UTC (after 09:00 UTC) claims and advances to next day.
	dueClaimAt := time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC)
	dueClaim, err := repo.ClaimDueSend(ctx, domain.NewID(), dueClaimAt, time.UTC, false)
	if err != nil {
		t.Fatalf("claim due send: %v", err)
	}

	if !dueClaim.Claimed || dueClaim.Record.Trigger != domain.KindleTriggerScheduled {
		t.Fatalf("due claim = %+v", dueClaim)
	}

	crashed := dueClaim.Record
	settingsAfterDue, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings after due claim: %v", err)
	}

	wantNextDay := time.Date(2024, 5, 2, 9, 0, 0, 0, time.UTC)
	if settingsAfterDue.Kindle == nil || settingsAfterDue.Kindle.NextSendAt == nil || !settingsAfterDue.Kindle.NextSendAt.Equal(wantNextDay) {
		t.Fatalf("next_send_at after due claim = %+v, want %v", settingsAfterDue.Kindle, wantNextDay)
	}
	recoveredAt := startedAt.Add(time.Hour)
	if err := repo.RecoverRunningOnStartup(ctx, recoveredAt); err != nil {
		t.Fatalf("recover running sends: %v", err)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after recovery: %v", err)
	}

	if len(recent) != 2 || recent[0].ID != crashed.ID {
		t.Fatalf("recent sends after recovery = %+v", recent)
	}

	if recent[0].Status != domain.KindleStatusFailed {
		t.Fatalf("recovered send status = %q, want failed", recent[0].Status)
	}

	if recent[0].Error == nil || *recent[0].Error != "server restarted while send was in progress" {
		t.Fatalf("recovered send error = %v", recent[0].Error)
	}

	if recent[0].FinishedAt == nil || !recent[0].FinishedAt.Equal(recoveredAt) {
		t.Fatalf("recovered send finished at = %v, want %v", recent[0].FinishedAt, recoveredAt)
	}

	failure := "smtp rejected https://user:secret@example.com/feed"
	if err := repo.CompleteSend(ctx, crashed.ID, domain.KindleStatusFailed, &failure, recoveredAt.Add(time.Minute)); err != nil {
		t.Fatalf("complete failed send: %v", err)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after failure: %v", err)
	}

	if recent[0].Error == nil || *recent[0].Error != "smtp rejected https://example.com/feed" {
		t.Fatalf("sanitized send error = %v", recent[0].Error)
	}
}

func TestKindleSendRepoPrunesHistory(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()
	configureKindleDeliveryForTest(t, store, domain.KindleSettings{KindleEmail: "reader@kindle.com"})

	base := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)
	ids := make([]string, kindleSendLimit+1)
	for i := range ids {
		startedAt := base.Add(time.Duration(i) * time.Minute)
		claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), startedAt)
		if err != nil {
			t.Fatalf("claim manual send %d: %v", i, err)
		}

		record := claimed.Record
		ids[i] = record.ID

		if err := repo.CompleteSend(ctx, record.ID, domain.KindleStatusSucceeded, nil, startedAt.Add(30*time.Second)); err != nil {
			t.Fatalf("complete send %d: %v", i, err)
		}
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != kindleSendLimit {
		t.Fatalf("recent sends = %d, want %d", len(recent), kindleSendLimit)
	}

	if recent[0].ID != ids[kindleSendLimit] || recent[len(recent)-1].ID != ids[1] {
		t.Fatalf("recent sends range = %s..%s", recent[len(recent)-1].ID, recent[0].ID)
	}

	var stored int
	if err := store.ReadDB().QueryRowContext(ctx, `SELECT COUNT(*) FROM kindle_send`).Scan(&stored); err != nil {
		t.Fatalf("count kindle sends: %v", err)
	}

	if stored != kindleSendLimit {
		t.Fatalf("stored kindle sends = %d, want %d", stored, kindleSendLimit)
	}
}

func TestKindleSendRepoListUnreadForKindle(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	savedPages := make([]domain.SavedPage, 3)
	for i := range savedPages {
		created, err := store.SavedPages().Create(ctx, domain.SavedPage{
			ID:      domain.NewID(),
			URL:     mustURL(t, "https://example.com/saved/"+domain.NewID()),
			Title:   fmt.Sprintf("Saved %d", i),
			Content: "<p>body</p>",
		})
		if err != nil {
			t.Fatalf("create saved page: %v", err)
		}

		savedPages[i] = created
	}

	if err := store.SavedPages().SetRead(ctx, savedPages[1].ID, true); err != nil {
		t.Fatalf("mark saved page read: %v", err)
	}

	alpha := createFeed(t, store, "Alpha", nil)
	zeta := createFeed(t, store, "Zeta", nil)
	empty := createFeed(t, store, "Empty", nil)
	readFeed := createFeed(t, store, "Read Feed", nil)

	if err := store.Feeds().UpdateOrder(ctx, alpha.ID, domain.SortOrderOldest); err != nil {
		t.Fatalf("update alpha order: %v", err)
	}

	alphaItems := addItems(t, store, alpha, 3)
	zetaItems := addItems(t, store, zeta, 2)
	readItems := addItems(t, store, readFeed, 2)

	if err := store.FeedItems().MarkFeedRead(ctx, readFeed.ID); err != nil {
		t.Fatalf("mark read feed read: %v", err)
	}

	unreadPages, feeds, items, err := store.KindleSends().ListUnreadForKindle(ctx)
	if err != nil {
		t.Fatalf("list unread for kindle: %v", err)
	}

	wantPages := []string{savedPages[0].ID, savedPages[2].ID}
	slices.Sort(wantPages)

	if got := savedPageIDs(unreadPages); !slices.Equal(got, wantPages) {
		t.Fatalf("unread saved page ids = %v, want %v in id ASC order", got, wantPages)
	}

	feedTitles := make([]string, len(feeds))
	for i, feed := range feeds {
		feedTitles[i] = feed.Title
	}

	if want := []string{"Alpha", "Zeta"}; !slices.Equal(feedTitles, want) {
		t.Fatalf("unread feed titles = %v, want %v", feedTitles, want)
	}

	if len(items) != 2 {
		t.Fatalf("grouped feed items = %d groups, want 2", len(items))
	}

	if got := itemIDs(items[alpha.ID]); !slices.Equal(got, []string{alphaItems[0].ID, alphaItems[1].ID, alphaItems[2].ID}) {
		t.Fatalf("alpha unread item ids = %v", got)
	}

	if got := itemIDs(items[zeta.ID]); !slices.Equal(got, []string{zetaItems[1].ID, zetaItems[0].ID}) {
		t.Fatalf("zeta unread item ids = %v", got)
	}

	if _, ok := items[empty.ID]; ok {
		t.Fatal("empty feed should not be listed")
	}

	if _, ok := items[readFeed.ID]; ok {
		t.Fatal("fully read feed should not be listed")
	}

	if len(readItems) != 2 {
		t.Fatalf("read feed items = %d, want 2", len(readItems))
	}
}

func TestKindleSendRepoRecordBookAccepted(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	feed := createFeed(t, store, "Example", nil)
	feedItems := addItems(t, store, feed, 2)

	savedPages := make([]domain.SavedPage, 2)
	for i := range savedPages {
		created, err := store.SavedPages().Create(ctx, domain.SavedPage{
			ID:      domain.NewID(),
			URL:     mustURL(t, "https://example.com/saved/"+domain.NewID()),
			Title:   fmt.Sprintf("Saved %d", i),
			Content: "<p>body</p>",
		})
		if err != nil {
			t.Fatalf("create saved page: %v", err)
		}

		savedPages[i] = created
	}

	configureKindleDeliveryForTest(t, store, domain.KindleSettings{KindleEmail: "reader@kindle.com"})

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("claim manual send: %v", err)
	}
	send := claimed.Record

	if err := repo.RecordBookAccepted(ctx, send.ID, []string{savedPages[0].ID}, []string{feedItems[0].ID}, 2); err != nil {
		t.Fatalf("record accepted book: %v", err)
	}

	page, err := store.SavedPages().GetByID(ctx, savedPages[0].ID)
	if err != nil {
		t.Fatalf("get saved page: %v", err)
	}

	if page == nil || !page.Read {
		t.Fatalf("accepted saved page = %+v, want read", page)
	}

	untouched, err := store.SavedPages().GetByID(ctx, savedPages[1].ID)
	if err != nil {
		t.Fatalf("get untouched saved page: %v", err)
	}

	if untouched == nil || untouched.Read {
		t.Fatalf("untouched saved page = %+v, want unread", untouched)
	}

	item, err := store.FeedItems().GetByID(ctx, feedItems[0].ID)
	if err != nil {
		t.Fatalf("get feed item: %v", err)
	}

	if item == nil || !item.Read {
		t.Fatalf("accepted feed item = %+v, want read", item)
	}

	pendingItem, err := store.FeedItems().GetByID(ctx, feedItems[1].ID)
	if err != nil {
		t.Fatalf("get pending feed item: %v", err)
	}

	if pendingItem == nil || pendingItem.Read {
		t.Fatalf("pending feed item = %+v, want unread", pendingItem)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, nil, []string{feedItems[1].ID}, 1); err != nil {
		t.Fatalf("record second accepted book: %v", err)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 1 || recent[0].ArticleCount != 3 || recent[0].BookCount != 2 {
		t.Fatalf("send counters = %+v, want 3 articles and 2 books", recent)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, nil, nil, 0); err != nil {
		t.Fatalf("record accepted book without articles: %v", err)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after empty book: %v", err)
	}

	if recent[0].ArticleCount != 3 || recent[0].BookCount != 3 {
		t.Fatalf("send counters after empty book = %+v", recent[0])
	}
}

func TestKindleSendRepoRecordBookAcceptedRequiresRunningSend(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	feed := createFeed(t, store, "Example", nil)
	feedItems := addItems(t, store, feed, 1)

	savedPage, err := store.SavedPages().Create(ctx, domain.SavedPage{
		ID:      domain.NewID(),
		URL:     mustURL(t, "https://example.com/saved/"+domain.NewID()),
		Title:   "Saved",
		Content: "<p>body</p>",
	})
	if err != nil {
		t.Fatalf("create saved page: %v", err)
	}

	configureKindleDeliveryForTest(t, store, domain.KindleSettings{KindleEmail: "reader@kindle.com"})

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("claim manual send: %v", err)
	}
	send := claimed.Record

	assertUnread := func(stage string) {
		t.Helper()

		page, err := store.SavedPages().GetByID(ctx, savedPage.ID)
		if err != nil {
			t.Fatalf("%s: get saved page: %v", stage, err)
		}

		if page == nil || page.Read {
			t.Fatalf("%s: saved page = %+v, want unread", stage, page)
		}

		item, err := store.FeedItems().GetByID(ctx, feedItems[0].ID)
		if err != nil {
			t.Fatalf("%s: get feed item: %v", stage, err)
		}

		if item == nil || item.Read {
			t.Fatalf("%s: feed item = %+v, want unread", stage, item)
		}
	}

	if err := repo.RecordBookAccepted(ctx, domain.NewID(), []string{savedPage.ID}, []string{feedItems[0].ID}, 1); err == nil {
		t.Fatal("expected an error for a missing send")
	}

	assertUnread("missing send")

	if err := repo.CompleteSend(ctx, send.ID, domain.KindleStatusSucceeded, nil, time.Date(2024, 5, 1, 8, 5, 0, 0, time.UTC)); err != nil {
		t.Fatalf("complete send: %v", err)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, []string{savedPage.ID}, []string{feedItems[0].ID}, 1); err == nil {
		t.Fatal("expected an error for a completed send")
	}

	assertUnread("completed send")

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 1 || recent[0].ArticleCount != 0 || recent[0].BookCount != 0 {
		t.Fatalf("send counters = %+v, want 0 articles and 0 books", recent)
	}
}

func TestKindleSendRepoClaimDueSendNeverInsertsWhileLocalSlotBusy(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	now := time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC)
	dueAt := now.Add(-30 * time.Minute)
	kindle := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		SendTime:    ptr("09:00"),
		NextSendAt:  &dueAt,
	}
	configureKindleDeliveryForTest(t, store, kindle)

	// The previous job already committed its terminal status (no running row) but
	// has not released the in-process slot yet.
	busy, err := repo.ClaimDueSend(ctx, domain.NewID(), now, time.UTC, true)
	if err != nil {
		t.Fatalf("ClaimDueSend() with busy slot error = %v", err)
	}

	if busy.Claimed {
		t.Fatalf("ClaimDueSend() claimed while the local slot was busy: %+v", busy)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 0 {
		t.Fatalf("busy claim left rows behind: %+v", recent)
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	wantNext := time.Date(2024, 5, 2, 9, 0, 0, 0, time.UTC)
	if settings.Kindle == nil || settings.Kindle.NextSendAt == nil || !settings.Kindle.NextSendAt.Equal(wantNext) {
		t.Fatalf("next_send_at after busy claim = %+v, want %v", settings.Kindle, wantNext)
	}

	// Once the slot is free the next due claim inserts exactly one running row.
	kindle.NextSendAt = &dueAt
	if err := store.Settings().UpdateKindle(ctx, kindle); err != nil {
		t.Fatalf("make schedule due again: %v", err)
	}

	claimed, err := repo.ClaimDueSend(ctx, domain.NewID(), now, time.UTC, false)
	if err != nil {
		t.Fatalf("ClaimDueSend() with free slot error = %v", err)
	}

	if !claimed.Claimed || claimed.Record.Trigger != domain.KindleTriggerScheduled || claimed.Record.Status != domain.KindleStatusRunning {
		t.Fatalf("ClaimDueSend() with free slot = %+v, want a running scheduled claim", claimed)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after claim: %v", err)
	}

	if len(recent) != 1 || recent[0].ID != claimed.Record.ID || recent[0].Status != domain.KindleStatusRunning {
		t.Fatalf("recent sends after claim = %+v, want the single running claim", recent)
	}
}

func TestKindleSendRepoClaimDueSendRaceWithSettingsUpdate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	now := time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC)
	dueAt := now.Add(-15 * time.Minute)
	futureAt := now.Add(5 * time.Hour)

	configureKindleDeliveryForTest(t, store, domain.KindleSettings{
		KindleEmail: "old@kindle.com",
		SendTime:    ptr("09:00"),
		NextSendAt:  &dueAt,
	})

	start := make(chan struct{})
	var wg sync.WaitGroup
	var claim domain.ClaimedKindleSend
	var claimErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		claim, claimErr = store.KindleSends().ClaimDueSend(ctx, domain.NewID(), now, time.UTC, false)
	}()
	go func() {
		defer wg.Done()
		<-start
		if err := store.Settings().UpdateKindle(ctx, domain.KindleSettings{
			KindleEmail: "new@kindle.com",
			SendTime:    ptr("15:00"),
			NextSendAt:  &futureAt,
		}); err != nil {
			t.Errorf("update kindle: %v", err)
		}
	}()

	close(start)
	wg.Wait()

	if claimErr != nil {
		t.Fatalf("ClaimDueSend() error = %v", claimErr)
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if claim.Claimed {
		// ClaimDueSend committed before UpdateKindle: snapshot used old settings and UpdateKindle's futureAt won afterward.
		if claim.Delivery.KindleEmail != "old@kindle.com" {
			t.Fatalf("claimed email = %q, want old@kindle.com", claim.Delivery.KindleEmail)
		}
		if settings.Kindle == nil || settings.Kindle.NextSendAt == nil || !settings.Kindle.NextSendAt.Equal(futureAt) {
			t.Fatalf("settings after UpdateKindle = %+v, want next_send_at = %v", settings.Kindle, futureAt)
		}
		return
	}

	// UpdateKindle committed before ClaimDueSend: ClaimDueSend saw futureAt and skipped without overwriting it.
	if settings.Kindle == nil || settings.Kindle.KindleEmail != "new@kindle.com" || settings.Kindle.NextSendAt == nil || !settings.Kindle.NextSendAt.Equal(futureAt) {
		t.Fatalf("settings after skipped claim = %+v, want new@kindle.com at %v", settings.Kindle, futureAt)
	}
}

func TestListOldestOrderPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	inside := createFeed(t, store, "Inside", &folder.ID)
	outside := createFeed(t, store, "Outside", nil)
	insideItems := addItems(t, store, inside, 3)
	outsideItems := addItems(t, store, outside, 2)
	allItems := append(slices.Clone(insideItems), outsideItems...)
	slices.SortFunc(allItems, func(a, b domain.FeedItem) int { return strings.Compare(a.ID, b.ID) })

	if err := store.FeedItems().SetRead(ctx, insideItems[1].ID, true); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	tests := []struct {
		name string
		list func(params domain.PageParams) (domain.PageResult[domain.FeedItem], error)
		all  []string
		read string
	}{
		{
			name: "all",
			list: func(params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
				return store.FeedItems().ListAll(ctx, params)
			},
			all:  itemIDs(allItems),
			read: insideItems[1].ID,
		},
		{
			name: "folder",
			list: func(params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
				return store.FeedItems().ListByFolder(ctx, folder.ID, params)
			},
			all:  itemIDs(insideItems),
			read: insideItems[1].ID,
		},
	}

	for _, test := range tests {
		for _, unread := range []bool{false, true} {
			want := slices.Clone(test.all)
			if unread {
				want = slices.DeleteFunc(want, func(id string) bool { return id == test.read })
			}

			var (
				got    []string
				cursor *string
			)
			for range len(want) + 1 {
				page, err := test.list(domain.PageParams{Limit: 2, Unread: unread, Order: domain.SortOrderOldest, Cursor: cursor})
				if err != nil {
					t.Fatalf("%s list oldest: %v", test.name, err)
				}

				got = append(got, itemIDs(page.Items)...)
				if page.Cursor == nil {
					break
				}

				cursor = page.Cursor
			}

			if !slices.Equal(got, want) {
				t.Fatalf("%s oldest unread=%v ids = %v, want %v", test.name, unread, got, want)
			}
		}
	}
}

func TestSavedPageListOldestOrderPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	pages := make([]domain.SavedPage, 5)
	for i := range pages {
		created, err := store.SavedPages().Create(ctx, domain.SavedPage{
			ID:      domain.NewID(),
			URL:     mustURL(t, "https://example.com/pages/"+domain.NewID()),
			Title:   fmt.Sprintf("Page %d", i),
			Content: "<p>body</p>",
		})
		if err != nil {
			t.Fatalf("create saved page: %v", err)
		}

		pages[i] = created
	}

	if err := store.SavedPages().SetRead(ctx, pages[1].ID, true); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	for _, unread := range []bool{false, true} {
		want := []string{}
		for _, page := range pages {
			if !unread || page.ID != pages[1].ID {
				want = append(want, page.ID)
			}
		}

		var (
			got    []string
			cursor *string
		)
		for range len(want) + 1 {
			page, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Unread: unread, Order: domain.SortOrderOldest, Cursor: cursor})
			if err != nil {
				t.Fatalf("list oldest saved pages: %v", err)
			}

			got = append(got, savedPageIDs(page.Items)...)
			if page.Cursor == nil {
				break
			}

			cursor = page.Cursor
		}

		if !slices.Equal(got, want) {
			t.Fatalf("saved pages oldest unread=%v ids = %v, want %v", unread, got, want)
		}
	}
}

func TestQueryPlansUseIndexes(t *testing.T) {
	store := newTestStore(t)
	cursor := domain.NewID()

	tests := []struct {
		name           string
		query          string
		args           []any
		index          string
		allowTempBTree bool
	}{
		{
			name:  "list all newest",
			query: listAllQuery(domain.PageParams{Limit: 30}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30}).args,
		},
		{
			name:  "list all with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Cursor: &cursor}).args,
		},
		{
			name:  "list all unread",
			query: listAllQuery(domain.PageParams{Limit: 30, Unread: true}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Unread: true}).args,
			index: "feed_item_read_id",
		},
		{
			name:  "list all oldest with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}).args,
		},
		{
			name:  "list all unread with cursor",
			query: listAllQuery(domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listAllQuery(domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_read_id",
		},
		{
			name:  "list feed newest",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30}).args,
			index: "feed_item_feed_id",
		},
		{
			name:  "list feed oldest",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).args,
			index: "feed_item_feed_id",
		},
		{
			name:  "list feed unread",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true}).args,
			index: "feed_item_feed_read_id",
		},
		{
			name:  "list feed unread with cursor",
			query: listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listByFeedQuery("feed", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_feed_read_id",
		},
		{
			name:           "list folder",
			query:          listByFolderQuery("folder", domain.PageParams{Limit: 30}).query,
			args:           listByFolderQuery("folder", domain.PageParams{Limit: 30}).args,
			index:          "feed_item_feed_id",
			allowTempBTree: true,
		},
		{
			name:           "list folder oldest",
			query:          listByFolderQuery("folder", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).query,
			args:           listByFolderQuery("folder", domain.PageParams{Limit: 30, Order: domain.SortOrderOldest}).args,
			index:          "feed_item_feed_id",
			allowTempBTree: true,
		},
		{
			name:  "list folder unread with cursor",
			query: listByFolderQuery("folder", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).query,
			args:  listByFolderQuery("folder", domain.PageParams{Limit: 30, Unread: true, Cursor: &cursor}).args,
			index: "feed_item_read_id",
		},
	}

	for _, test := range tests {
		details := queryPlan(t, store, test.query, test.args...)
		requireIndexedPlan(t, test.name, details, test.index, test.allowTempBTree)
	}

	unreadDetails := queryPlan(t, store, unreadCountsQuery)
	if !slices.ContainsFunc(unreadDetails, func(detail string) bool {
		return strings.Contains(detail, "USING INDEX")
	}) {
		t.Fatalf("unread counts plan does not use an index:\n%s", strings.Join(unreadDetails, "\n"))
	}

	for _, params := range []domain.PageParams{{Limit: 30}, {Limit: 30, Unread: true}, {Limit: 30, Unread: true, Cursor: &cursor}, {Limit: 30, Order: domain.SortOrderOldest, Cursor: &cursor}, {Limit: 30, Unread: true, Order: domain.SortOrderOldest}} {
		query, args := listSavedPagesQuery(params)
		requireIndexedPlan(t, "list saved pages", queryPlan(t, store, query, args...), "", false)
	}

	storedRefsPlan := queryPlan(t, store, `SELECT id, url FROM feed_item WHERE feed_id = ? ORDER BY id DESC`, "feed")
	requireIndexedPlan(t, "list stored refs by feed", storedRefsPlan, "feed_item_feed_id_url", false)
	if !slices.ContainsFunc(storedRefsPlan, func(detail string) bool {
		return strings.Contains(detail, "USING COVERING INDEX feed_item_feed_id_url")
	}) {
		t.Fatalf("stored refs plan is not a covering index:\n%s", strings.Join(storedRefsPlan, "\n"))
	}
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

func ptr(value string) *string {
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

func createFeed(t *testing.T, store *Store, title string, folderID *string) domain.Feed {
	t.Helper()

	feed, err := store.Feeds().Create(context.Background(), domain.Feed{
		ID:       domain.NewID(),
		URL:      mustURL(t, "https://example.com/feeds/"+domain.NewID()),
		Title:    title,
		FolderID: folderID,
	})
	if err != nil {
		t.Fatalf("create feed %q: %v", title, err)
	}

	return feed
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

	err := store.Feeds().ApplySync(context.Background(), feed.ID, feed.Title, time.Now().UTC(), items, nil)
	if err != nil {
		t.Fatalf("sync items for feed %q: %v", feed.Title, err)
	}

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

	if got.SendTime == nil || *got.SendTime != *want.SendTime {
		t.Fatalf("send time = %v, want %v", got.SendTime, want.SendTime)
	}

	if got.NextSendAt == nil || !got.NextSendAt.Equal(*want.NextSendAt) {
		t.Fatalf("next send at = %v, want %v", got.NextSendAt, want.NextSendAt)
	}
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
		if detail == "SCAN feed_item" || detail == "SCAN saved_page" {
			t.Fatalf("%s: plan scans the table without an index:\n%s", name, plan)
		}
	}

	if index != "" && !strings.Contains(plan, "USING INDEX "+index) && !strings.Contains(plan, "USING COVERING INDEX "+index) {
		t.Fatalf("%s: plan does not use index %q:\n%s", name, index, plan)
	}
}
