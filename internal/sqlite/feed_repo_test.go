package sqlite

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"reader/internal/domain"
)

func TestFeedRepoCreate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := refreshAt(7)

	created, err := store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title:      "Example",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, now)
	if err != nil {
		t.Fatalf("create feed: %v", err)
	}

	if created.ReaderMode != domain.ReaderModeDefault || created.Order != domain.SortOrderNewest {
		t.Fatalf("created feed defaults = %+v", created)
	}

	if created.FolderID != nil || created.UpdatedAt != nil || created.LastError != nil || created.FailureCount != 0 {
		t.Fatalf("created feed carries unexpected values: %+v", created)
	}

	requireNextRefreshAt(t, store, created, now)
	requireFeedState(t, store, created, nil, 0, nil)

	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title:      "Duplicate",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, now)
	conflict := requireCode(t, err, domain.ErrFeedAlreadyExists)
	if conflict.URL != "https://example.com/feed.xml" {
		t.Fatalf("conflict url = %q, want %q", conflict.URL, "https://example.com/feed.xml")
	}

	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("conflict error leaks credentials: %v", err)
	}

	missingFolder := "missing-folder"
	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://example.com/other.xml"),
		Title:      "Other",
		FolderID:   &missingFolder,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, now)
	requireCode(t, err, domain.ErrFolderNotFound)

	if feeds, schedules := countRows(t, store, `SELECT COUNT(*) FROM feed`), countRows(t, store, `SELECT COUNT(*) FROM feed_schedule`); feeds != 1 || schedules != 1 {
		t.Fatalf("feeds and schedules after rejected creates = %d/%d, want 1/1", feeds, schedules)
	}
}

func TestFeedRepoCreateAtBudgetCapacity(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	if err := store.Settings().UpdateRetention(ctx, domain.FeedItemBudget); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	first := createFeed(t, store, "At capacity", nil)
	for _, test := range []struct {
		name     string
		url      domain.NormalizedURL
		folderID *string
		want     domain.ErrorCode
	}{
		{name: "new feed", url: mustURL(t, "https://example.com/over-budget"), want: domain.ErrFeedItemBudgetExceeded},
		{name: "duplicate", url: first.URL, want: domain.ErrFeedAlreadyExists},
		{name: "missing folder", url: mustURL(t, "https://example.com/missing-folder"), folderID: ptr("missing"), want: domain.ErrFolderNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := store.Feeds().Create(ctx, domain.Feed{
				ID: domain.NewID(), URL: test.url, Title: test.name, FolderID: test.folderID,
				ReaderMode: domain.ReaderModeDefault, Order: domain.SortOrderNewest,
			}, refreshAt(1))
			requireCode(t, err, test.want)
			if feeds, schedules := countRows(t, store, `SELECT COUNT(*) FROM feed`), countRows(t, store, `SELECT COUNT(*) FROM feed_schedule`); feeds != 1 || schedules != 1 {
				t.Fatalf("feeds and schedules after rejected create = %d/%d, want 1/1", feeds, schedules)
			}
		})
	}
}

func TestFeedRepoCreateCountsExcessStoredItems(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	if err := store.Settings().UpdateRetention(ctx, 2); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	heavy := createFeed(t, store, "Excess", nil)
	tx, err := store.WriteDB().BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin seed: %v", err)
	}

	for n := range domain.FeedItemBudget - 1 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO feed_item (id, feed_id, url, title) VALUES (?, ?, ?, 'Item')`, domain.NewID(), heavy.ID, fmt.Sprintf("https://example.com/excess/%d", n)); err != nil {
			t.Fatalf("seed excess item: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("commit seed: %v", err)
	}

	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID: domain.NewID(), URL: mustURL(t, "https://example.com/second"), Title: "Second",
		ReaderMode: domain.ReaderModeDefault, Order: domain.SortOrderNewest,
	}, refreshAt(1))
	requireCode(t, err, domain.ErrFeedItemBudgetExceeded)

	if feeds := countRows(t, store, `SELECT COUNT(*) FROM feed`); feeds != 1 {
		t.Fatalf("feeds after rejected create = %d, want 1", feeds)
	}

	if err := store.Settings().UpdateRetention(ctx, 1); err != nil {
		t.Fatalf("lowering retention must prune before checking the budget: %v", err)
	}

	if items := countRows(t, store, `SELECT COUNT(*) FROM feed_item`); items != 1 {
		t.Fatalf("items after lowering retention = %d, want 1", items)
	}
}

func TestFeedRepoCreateRollsBackFeedWhenScheduleFails(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if _, err := store.WriteDB().ExecContext(
		ctx,
		`CREATE TRIGGER fail_schedule_insert BEFORE INSERT ON feed_schedule BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
	); err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	_, err := store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://example.com/feed.xml"),
		Title:      "Example",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, refreshAt(0))
	requireCode(t, err, domain.ErrFeedRepositoryError)

	if got := countRows(t, store, `SELECT COUNT(*) FROM feed`); got != 0 {
		t.Fatalf("feeds after a failed schedule insert = %d, want the feed rolled back", got)
	}
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
	}, refreshAt(0))
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

	if err := store.Feeds().UpdateReaderMode(ctx, feed.ID, domain.ReaderModeExtracted); err != nil {
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

	if updated.ReaderMode != domain.ReaderModeExtracted || updated.Order != domain.SortOrderOldest {
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
}

func TestFeedRepoSucceedRefresh(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	startedAt := time.Date(2024, 3, 1, 10, 59, 0, 0, time.UTC)
	finishedAt := time.Date(2024, 3, 1, 11, 0, 0, 0, time.UTC).In(time.FixedZone("plus-two", 2*60*60))
	recordFailure(t, store, feed, "boom", startedAt)

	publishedAt := time.Date(2024, 3, 1, 10, 30, 0, 0, time.UTC)
	entries := []domain.ParsedFeedEntry{
		{URL: mustURL(t, "https://example.com/a"), Title: "A", PublishedAt: &publishedAt},
		{URL: mustURL(t, "https://example.com/b"), Title: "B"},
	}

	meta := domain.FeedSyncMeta{Title: "Synced", SiteURL: ptr("https://example.com/"), IconURL: ptr("https://example.com/icon.png")}
	succeedRefresh(t, store, feed, meta, entries, finishedAt)

	synced, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get synced feed: %v", err)
	}

	if synced.Title != "Synced" {
		t.Fatalf("synced title = %q, want Synced", synced.Title)
	}

	if synced.SiteURL == nil || *synced.SiteURL != "https://example.com/" || synced.IconURL == nil || *synced.IconURL != "https://example.com/icon.png" {
		t.Fatalf("synced site/icon = %v/%v", synced.SiteURL, synced.IconURL)
	}

	if synced.UpdatedAt == nil || !synced.UpdatedAt.Equal(finishedAt) {
		t.Fatalf("synced updated at = %v, want %v", synced.UpdatedAt, finishedAt)
	}

	if synced.FailureCount != 0 || synced.LastError != nil {
		t.Fatalf("synced feed failure state = %d/%v, want 0/nil", synced.FailureCount, synced.LastError)
	}

	stored := loadTestFeedItems(t, store, feed.ID)

	if len(stored) != 2 || stored[0].URL != entries[0].URL || stored[1].URL != entries[1].URL {
		t.Fatalf("synced items = %v, want A then B", stored)
	}

	if stored[0].PublishedAt == nil || !stored[0].PublishedAt.Equal(publishedAt) {
		t.Fatalf("stored published at = %v, want %v", stored[0].PublishedAt, publishedAt)
	}

	duplicate := []domain.ParsedFeedEntry{{URL: mustURL(t, "https://example.com/a"), Title: "A again"}}
	succeedRefresh(t, store, feed, domain.FeedSyncMeta{Title: "Synced"}, duplicate, finishedAt.Add(time.Minute))

	cleared, err := store.Feeds().GetByID(ctx, feed.ID)
	if err != nil {
		t.Fatalf("get feed after metadata-less sync: %v", err)
	}

	if cleared.SiteURL != nil || cleared.IconURL != nil {
		t.Fatalf("site/icon after sync without them = %v/%v, want both replaced by nil", cleared.SiteURL, cleared.IconURL)
	}

	afterDuplicate := loadTestFeedItems(t, store, feed.ID)

	if len(afterDuplicate) != 2 {
		t.Fatalf("items after duplicate sync = %d, want 2", len(afterDuplicate))
	}

	if got := afterDuplicate[0]; got.ID != stored[0].ID || got.Title != stored[0].Title || got.URL != stored[0].URL || got.PublishedAt == nil || !got.PublishedAt.Equal(publishedAt) {
		t.Fatalf("duplicate changed original item: %+v", got)
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

func feedsByTitle(t *testing.T, store *Store) map[string]domain.Feed {
	t.Helper()

	feeds, err := store.Feeds().List(context.Background())
	if err != nil {
		t.Fatalf("list feeds: %v", err)
	}

	byTitle := make(map[string]domain.Feed, len(feeds))
	for _, feed := range feeds {
		byTitle[feed.Title] = feed
	}

	return byTitle
}

func TestStoreImportOPML(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	now := refreshAt(10)

	tech := createFolder(t, store, "Tech")
	existing := createFeedDueAt(t, store, "Existing", &tech.ID, refreshAt(0))

	doc := domain.OPMLDocument{
		Folders: []string{"News", "Tech"},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/news-1"), Title: "News 1", FolderName: ptr("News")},
			{URL: mustURL(t, "https://example.com/news-2"), Title: "News 2", FolderName: ptr("News")},
			{URL: mustURL(t, "https://example.com/top"), Title: "Top"},
			{URL: existing.URL, Title: "Existing"},
			{URL: mustURL(t, "https://example.com/tech-1"), Title: "Tech 1", FolderName: ptr("Tech")},
		},
		SkippedInvalid: 2,
	}

	result, err := store.Feeds().ImportOPML(ctx, doc, now)
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

	newsFolderID := folderIDByName(t, store, "News")
	byTitle := feedsByTitle(t, store)
	if len(byTitle) != 5 {
		t.Fatalf("feeds after import = %d, want 5", len(byTitle))
	}

	for _, title := range []string{"News 1", "News 2", "Top", "Tech 1"} {
		feed := byTitle[title]
		if feed.ReaderMode != domain.ReaderModeDefault || feed.Order != domain.SortOrderNewest {
			t.Fatalf("imported feed %q defaults = %+v", title, feed)
		}

		requireFeedState(t, store, feed, nil, 0, nil)
		requireNextRefreshAt(t, store, feed, now)
	}

	requireNextRefreshAt(t, store, existing, refreshAt(0))

	if folderID := byTitle["News 1"].FolderID; folderID == nil || *folderID != newsFolderID {
		t.Fatalf("news feed folder = %v, want %s", folderID, newsFolderID)
	}

	if folderID := byTitle["Top"].FolderID; folderID != nil {
		t.Fatalf("top level feed folder = %v, want nil", *folderID)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	if len(folders) != 2 {
		t.Fatalf("folders after import = %d, want 2", len(folders))
	}

	repoResult, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Folders: []string{"Later"},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/later-1"), Title: "Later 1", FolderName: ptr("Later")},
			{URL: mustURL(t, "https://example.com/top"), Title: "Top duplicate"},
		},
	}, refreshAt(20))
	if err != nil {
		t.Fatalf("import opml through feed repo: %v", err)
	}

	if repoResult.ImportedFeeds != 1 || repoResult.SkippedFeeds != 1 || repoResult.CreatedFolders != 1 {
		t.Fatalf("feed repo import result = %+v", repoResult)
	}

	later := feedsByTitle(t, store)["Later 1"]
	if later.ID == "" {
		t.Fatal("imported feed Later 1 is missing")
	}

	requireNextRefreshAt(t, store, later, refreshAt(20))
	requireNextRefreshAt(t, store, byTitle["Top"], now)
}

func TestImportOPMLDuplicateURLsCreateOneFeedAndSchedule(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	url := mustURL(t, "https://example.com/duplicate")

	result, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Feeds: []domain.OPMLFeedInput{
			{URL: url, Title: "First"},
			{URL: url, Title: "Second"},
		},
	}, refreshAt(3))
	if err != nil {
		t.Fatalf("import opml: %v", err)
	}

	if result.ImportedFeeds != 1 || result.SkippedFeeds != 1 {
		t.Fatalf("import result = %+v, want one imported and one skipped", result)
	}

	if feeds, schedules := countRows(t, store, `SELECT COUNT(*) FROM feed`), countRows(t, store, `SELECT COUNT(*) FROM feed_schedule`); feeds != 1 || schedules != 1 {
		t.Fatalf("feeds and schedules = %d/%d, want 1/1", feeds, schedules)
	}

	feed := feedsByTitle(t, store)["First"]
	if feed.ID == "" {
		t.Fatal("the first duplicate was not the one imported")
	}

	requireNextRefreshAt(t, store, feed, refreshAt(3))
}

func TestImportOPMLAtBudgetCapacity(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	if err := store.Settings().UpdateRetention(ctx, domain.FeedItemBudget); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	first := createFeed(t, store, "At capacity", nil)
	duplicate := domain.OPMLFeedInput{URL: first.URL, Title: "Duplicate"}
	_, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Folders: []string{"Over budget"},
		Feeds: []domain.OPMLFeedInput{
			duplicate,
			{URL: mustURL(t, "https://example.com/new"), Title: "New", FolderName: ptr("Over budget")},
		},
	}, refreshAt(1))
	requireCode(t, err, domain.ErrFeedItemBudgetExceeded)
	if folders := countRows(t, store, `SELECT COUNT(*) FROM folder`); folders != 0 {
		t.Fatalf("folders after rejected import = %d, want 0", folders)
	}

	if feeds, schedules := countRows(t, store, `SELECT COUNT(*) FROM feed`), countRows(t, store, `SELECT COUNT(*) FROM feed_schedule`); feeds != 1 || schedules != 1 {
		t.Fatalf("feeds and schedules after rejected import = %d/%d, want 1/1", feeds, schedules)
	}

	result, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{Feeds: []domain.OPMLFeedInput{duplicate}}, refreshAt(2))
	if err != nil || result.ImportedFeeds != 0 || result.SkippedFeeds != 1 {
		t.Fatalf("duplicate-only import = (%+v, %v), want one skipped feed", result, err)
	}
}

func TestImportOPMLIsAtomic(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if _, err := store.WriteDB().ExecContext(
		ctx,
		`CREATE TRIGGER fail_second_opml_feed BEFORE INSERT ON feed WHEN NEW.url = 'https://example.com/atomic-2' BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
	); err != nil {
		t.Fatalf("create trigger: %v", err)
	}

	doc := domain.OPMLDocument{
		Folders: []string{"Atomic"},
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/atomic-1"), Title: "Atomic 1", FolderName: ptr("Atomic")},
			{URL: mustURL(t, "https://example.com/atomic-2"), Title: "Atomic 2", FolderName: ptr("Atomic")},
		},
	}

	if _, err := store.Feeds().ImportOPML(ctx, doc, refreshAt(0)); err == nil {
		t.Fatal("expected the import to fail")
	} else {
		requireCode(t, err, domain.ErrFeedRepositoryError)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders after failed import: %v", err)
	}

	if len(folders) != 0 {
		t.Fatalf("folders after failed import = %v, want none", folders)
	}

	if got := countRows(t, store, `SELECT (SELECT COUNT(*) FROM feed) + (SELECT COUNT(*) FROM feed_schedule)`); got != 0 {
		t.Fatalf("feed and schedule rows after failed import = %d, want none", got)
	}
}

func TestImportOPMLNoFolders(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	unrelated := createFolder(t, store, "Unrelated")

	topResult, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/no-folder"), Title: "No Folder"},
		},
	}, refreshAt(0))
	if err != nil {
		t.Fatalf("import opml without folders: %v", err)
	}

	if topResult.CreatedFolders != 0 || topResult.ImportedFeeds != 1 {
		t.Fatalf("top-level import = %+v", topResult)
	}

	folders, err := store.Folders().List(ctx)
	if err != nil {
		t.Fatalf("list folders: %v", err)
	}

	if !slices.Contains(folders, unrelated) {
		t.Fatalf("folders = %+v, want %+v intact", folders, unrelated)
	}
}

func TestFeedRepoListRejectsStoredURLWithInvalidPort(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	if _, err := store.WriteDB().ExecContext(ctx, `INSERT INTO feed (id, url, title) VALUES ('bad', 'http://example.com:99999/feed', 'Bad')`); err != nil {
		t.Fatalf("insert feed: %v", err)
	}

	if _, err := store.WriteDB().ExecContext(ctx, `INSERT INTO feed_schedule (feed_id, next_refresh_at) VALUES ('bad', 0)`); err != nil {
		t.Fatalf("insert feed schedule: %v", err)
	}

	if _, err := store.Feeds().List(ctx); err == nil {
		t.Fatal("List() error = nil, want an error for a stored URL with an invalid port")
	}
}
