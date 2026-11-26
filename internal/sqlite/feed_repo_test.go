package sqlite

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"reader/internal/domain"
)

func TestFeedRepoCreate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	created, err := store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title:      "Example",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
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

	_, err = store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://user:secret@example.com/feed.xml"),
		Title:      "Duplicate",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
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
		ID:         domain.NewID(),
		URL:        mustURL(t, "https://example.com/other.xml"),
		Title:      "Other",
		FolderID:   &missingFolder,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
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
	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", nil, updatedAt, items, nil); err != nil {
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

	stored, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
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
	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", nil, updatedAt, duplicate, nil); err != nil {
		t.Fatalf("apply sync with duplicate url: %v", err)
	}

	afterDuplicate, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list items after duplicate sync: %v", err)
	}

	if len(afterDuplicate.Items) != 2 {
		t.Fatalf("items after duplicate sync = %d, want 2", len(afterDuplicate.Items))
	}

	if got := afterDuplicate.Items[1]; got.ID != items[0].ID || got.Title != items[0].Title || got.URL != items[0].URL || got.PublishedAt == nil || !got.PublishedAt.Equal(publishedAt) {
		t.Fatalf("duplicate changed original item: %+v", got)
	}

	if err := store.Feeds().ApplySync(ctx, feed.ID, "Synced", nil, updatedAt, nil, []string{items[0].ID}); err != nil {
		t.Fatalf("apply sync with deletions: %v", err)
	}

	afterDelete, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list items after deletion sync: %v", err)
	}

	if got := itemIDs(afterDelete.Items); !slices.Equal(got, []string{items[1].ID}) {
		t.Fatalf("items after deletion sync = %v", got)
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

func TestStoreImportOPML(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	tech := createFolder(t, store, "Tech")
	existing := createFeed(t, store, "Existing", &tech.ID)

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

	if _, _, err := store.Feeds().ImportOPML(ctx, doc); err == nil {
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

	feeds, err := store.Feeds().List(ctx)
	if err != nil {
		t.Fatalf("list feeds after failed import: %v", err)
	}

	if len(feeds) != 0 {
		t.Fatalf("feeds after failed import = %v, want none", feeds)
	}
}

func TestImportOPMLNoFolders(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	unrelated := createFolder(t, store, "Unrelated")

	topResult, topIDs, err := store.Feeds().ImportOPML(ctx, domain.OPMLDocument{
		Feeds: []domain.OPMLFeedInput{
			{URL: mustURL(t, "https://example.com/no-folder"), Title: "No Folder"},
		},
	})
	if err != nil {
		t.Fatalf("import opml without folders: %v", err)
	}

	if topResult.CreatedFolders != 0 || topResult.ImportedFeeds != 1 || len(topIDs) != 1 {
		t.Fatalf("top-level import = (%+v, %v)", topResult, topIDs)
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

	if _, err := store.Feeds().List(ctx); err == nil {
		t.Fatal("List() error = nil, want an error for a stored URL with an invalid port")
	}
}
