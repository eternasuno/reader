package sqlite

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"

	"reader/internal/domain"
)

func TestGroupedFeedItemSnapshots(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.FeedItems()
	folder := createFolder(t, store, "News")
	oldest := createFeed(t, store, "Oldest", &folder.ID)
	newest := createFeed(t, store, "Newest", &folder.ID)
	outside := createFeed(t, store, "Outside", nil)
	if err := store.Feeds().UpdateOrder(ctx, oldest.ID, domain.SortOrderOldest); err != nil {
		t.Fatalf("set oldest order: %v", err)
	}

	addSnapshotItems(t, store, oldest, 1, 3, 7)
	addSnapshotItems(t, store, newest, 2, 5, 8)
	addSnapshotItems(t, store, outside, 4, 6)
	if err := repo.SetRead(ctx, fixedTestID(7), true); err != nil {
		t.Fatalf("mark newest item in oldest feed read: %v", err)
	}

	params := domain.SnapshotParams{Boundary: fixedTestID(7)}
	all, err := repo.SnapshotAll(ctx, params)
	requireFeedItemGroups(t, all, err,
		domain.FeedItemGroup{FeedID: oldest.ID, IDs: snapshotTestIDs(1, 3, 7)},
		domain.FeedItemGroup{FeedID: outside.ID, IDs: snapshotTestIDs(6, 4)},
		domain.FeedItemGroup{FeedID: newest.ID, IDs: snapshotTestIDs(5, 2)},
	)

	params.Unread = true
	folderGroups, err := repo.SnapshotByFolder(ctx, folder.ID, params)
	requireFeedItemGroups(t, folderGroups, err,
		domain.FeedItemGroup{FeedID: oldest.ID, IDs: snapshotTestIDs(1, 3)},
		domain.FeedItemGroup{FeedID: newest.ID, IDs: snapshotTestIDs(5, 2)},
	)

	unread, err := repo.SnapshotAll(ctx, params)
	requireFeedItemGroups(t, unread, err,
		domain.FeedItemGroup{FeedID: oldest.ID, IDs: snapshotTestIDs(1, 3)},
		domain.FeedItemGroup{FeedID: outside.ID, IDs: snapshotTestIDs(6, 4)},
		domain.FeedItemGroup{FeedID: newest.ID, IDs: snapshotTestIDs(5, 2)},
	)

	missing, err := repo.SnapshotByFolder(ctx, "missing", params)
	requireFeedItemGroups(t, missing, err)
}

func TestSingleFeedItemSnapshot(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.FeedItems()
	feed := createFeed(t, store, "Example", nil)
	addSnapshotItems(t, store, feed, 1, 2, 3, 4)
	if err := repo.SetRead(ctx, fixedTestID(2), true); err != nil {
		t.Fatalf("mark item read: %v", err)
	}

	params := domain.SnapshotParams{Boundary: fixedTestID(3)}
	newest, err := repo.SnapshotByFeed(ctx, feed.ID, domain.SortOrderNewest, params)
	requireFeedItemGroups(t, newest, err, domain.FeedItemGroup{FeedID: feed.ID, IDs: snapshotTestIDs(3, 2, 1)})
	oldest, err := repo.SnapshotByFeed(ctx, feed.ID, domain.SortOrderOldest, params)
	requireFeedItemGroups(t, oldest, err, domain.FeedItemGroup{FeedID: feed.ID, IDs: snapshotTestIDs(1, 2, 3)})
	params.Unread = true
	unread, err := repo.SnapshotByFeed(ctx, feed.ID, domain.SortOrderOldest, params)
	requireFeedItemGroups(t, unread, err, domain.FeedItemGroup{FeedID: feed.ID, IDs: snapshotTestIDs(1, 3)})
	missing, err := repo.SnapshotByFeed(ctx, "missing", domain.SortOrderNewest, params)
	requireFeedItemGroups(t, missing, err)
}

func TestFeedItemGetByIDs(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)
	addSnapshotItems(t, store, feed, 1, 2, 3)

	items, err := store.FeedItems().GetByIDs(ctx, snapshotTestIDs(2, 4, 1, 3))
	if err != nil || !slices.Equal(itemIDs(items), snapshotTestIDs(2, 1, 3)) {
		t.Fatalf("batch returned %v, err %v", itemIDs(items), err)
	}

	empty, err := store.FeedItems().GetByIDs(ctx, snapshotTestIDs(4))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("missing batch returned %v, err %v", empty, err)
	}
}

func TestFeedItemSnapshotOverflow(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	folder := createFolder(t, store, "News")
	feed := createFeed(t, store, "Example", &folder.ID)
	seedFeedItemRows(t, store.WriteDB(), feed.ID, domain.ListSnapshotLimit+1)

	repo := store.FeedItems()
	params := domain.SnapshotParams{Boundary: maxTestBoundary}
	_, err := repo.SnapshotAll(ctx, params)
	requireCode(t, err, domain.ErrFeedItemRepositoryError)
	_, err = repo.SnapshotByFolder(ctx, folder.ID, params)
	requireCode(t, err, domain.ErrFeedItemRepositoryError)
	_, err = repo.SnapshotByFeed(ctx, feed.ID, domain.SortOrderNewest, params)
	requireCode(t, err, domain.ErrFeedItemRepositoryError)
}

func requireFeedItemGroups(t *testing.T, got []domain.FeedItemGroup, err error, want ...domain.FeedItemGroup) {
	t.Helper()

	if err != nil || got == nil || !slices.EqualFunc(got, want, func(a, b domain.FeedItemGroup) bool {
		return a.FeedID == b.FeedID && slices.Equal(a.IDs, b.IDs)
	}) {
		t.Fatalf("snapshot returned %+v, err %v, want %+v", got, err, want)
	}
}

func snapshotTestIDs(seqs ...uint64) []string {
	ids := make([]string, len(seqs))
	for i, seq := range seqs {
		ids[i] = fixedTestID(seq)
	}

	return ids
}

func addSnapshotItems(t *testing.T, store *Store, feed domain.Feed, seqs ...uint64) {
	t.Helper()

	items := make([]domain.FeedItem, len(seqs))
	for i, id := range snapshotTestIDs(seqs...) {
		items[i] = domain.FeedItem{ID: id, FeedID: feed.ID, URL: mustURL(t, "https://example.com/items/"+id), Title: feed.Title}
	}

	seedFeedItems(t, store, feed, items)
}

func loadTestFeedItems(t *testing.T, store *Store, feedID string) []domain.FeedItem {
	t.Helper()

	ctx := context.Background()
	repo := store.FeedItems()
	groups, err := repo.SnapshotByFeed(ctx, feedID, domain.SortOrderNewest, domain.SnapshotParams{Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("snapshot feed items: %v", err)
	}

	if len(groups) == 0 {
		return nil
	}

	items, err := repo.GetByIDs(ctx, groups[0].IDs)
	if err != nil {
		t.Fatalf("load feed items: %v", err)
	}

	return items
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

	counts, err := store.FeedItems().UnreadCounts(ctx, maxTestBoundary)
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

	if err := store.FeedItems().MarkFeedRead(ctx, first.ID, maxTestBoundary); err != nil {
		t.Fatalf("mark feed read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx, maxTestBoundary)
	if err != nil {
		t.Fatalf("unread counts after feed mark: %v", err)
	}

	if got := unreadCountMap(counts); got[first.ID] != 0 || got[second.ID] != 1 || got[outside.ID] != 2 {
		t.Fatalf("unread counts after feed mark = %v", got)
	}

	if err := store.FeedItems().MarkFolderRead(ctx, folder.ID, maxTestBoundary); err != nil {
		t.Fatalf("mark folder read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx, maxTestBoundary)
	if err != nil {
		t.Fatalf("unread counts after folder mark: %v", err)
	}

	if got := unreadCountMap(counts); got[first.ID] != 0 || got[second.ID] != 0 || got[outside.ID] != 2 {
		t.Fatalf("unread counts after folder mark = %v", got)
	}

	if err := store.FeedItems().MarkAllRead(ctx, maxTestBoundary); err != nil {
		t.Fatalf("mark all read: %v", err)
	}

	counts, err = store.FeedItems().UnreadCounts(ctx, maxTestBoundary)
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
	cases := []struct {
		name      string
		existing  *string
		wantWrote bool
		missing   bool
	}{
		{name: "missing", missing: true},
		{name: "null", existing: nil, wantWrote: true},
		{name: "text", existing: ptr("<p>first</p>"), wantWrote: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t)
			ctx := context.Background()
			if tc.missing {
				_, wrote, err := store.FeedItems().SaveExtractedContentIfEmpty(ctx, "missing", "<p>x</p>")
				requireCode(t, err, domain.ErrFeedItemNotFound)
				if wrote {
					t.Fatal("wrote = true for a missing item")
				}

				return
			}

			feed := createFeed(t, store, "Example", nil)
			item := domain.FeedItem{
				ID:               domain.NewID(),
				FeedID:           feed.ID,
				URL:              mustURL(t, "https://example.com/items/"+domain.NewID()),
				Title:            "Item",
				ExtractedContent: tc.existing,
			}

			seedFeedItems(t, store, feed, []domain.FeedItem{item})

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

func TestFeedItemStoredRefsAndRetention(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Example", nil)

	items := []domain.FeedItem{
		{ID: domain.NewID(), URL: mustURL(t, "https://example.com/first"), Title: "First"},
		{ID: domain.NewID(), URL: mustURL(t, "https://user:secret@example.com/second"), Title: "Second"},
	}
	seedFeedItems(t, store, feed, items)

	refs, err := listStoredRefsByFeed(ctx, store.ReadDB(), feed.ID)
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

	remaining, err := listStoredRefsByFeed(ctx, store.ReadDB(), feed.ID)
	if err != nil {
		t.Fatalf("list stored refs after delete: %v", err)
	}

	if len(remaining) != 0 {
		t.Fatalf("stored refs after delete = %d, want 0", len(remaining))
	}
}

func TestFeedItemReadMarkingBoundary(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	folder := createFolder(t, store, "News")
	feedA := createFeed(t, store, "Feed A", &folder.ID)
	feedB := createFeed(t, store, "Feed B", &folder.ID)
	outside := createFeed(t, store, "Outside", nil)

	syncFixed := func(feed domain.Feed, seqs ...uint64) {
		items := make([]domain.FeedItem, len(seqs))
		for i, seq := range seqs {
			id := fixedTestID(seq)
			items[i] = domain.FeedItem{
				ID:     id,
				FeedID: feed.ID,
				URL:    mustURL(t, "https://example.com/items/"+id),
				Title:  fmt.Sprintf("%s %d", feed.Title, seq),
			}
		}
		seedFeedItems(t, store, feed, items)
	}

	syncFixed(feedA, 1, 2, 5)
	syncFixed(feedB, 3, 6)
	syncFixed(outside, 4)

	if err := store.FeedItems().SetRead(ctx, fixedTestID(2), true); err != nil {
		t.Fatalf("mark item 2 read: %v", err)
	}

	boundary := fixedTestID(6)
	syncFixed(feedA, 7)
	syncFixed(feedB, 8)
	syncFixed(outside, 9)
	counts, err := store.FeedItems().UnreadCounts(ctx, boundary)
	if err != nil {
		t.Fatalf("bounded unread counts: %v", err)
	}
	if got := unreadCountMap(counts); got[feedA.ID] != 2 || got[feedB.ID] != 2 || got[outside.ID] != 1 {
		t.Fatalf("bounded unread counts = %v", got)
	}

	if err := store.FeedItems().MarkFeedRead(ctx, feedA.ID, boundary); err != nil {
		t.Fatalf("mark feed read: %v", err)
	}
	counts, err = store.FeedItems().UnreadCounts(ctx, boundary)
	if err != nil {
		t.Fatalf("unread counts after feed mark: %v", err)
	}
	if got := unreadCountMap(counts); got[feedA.ID] != 0 || got[feedB.ID] != 2 || got[outside.ID] != 1 {
		t.Fatalf("bounded counts after feed mark = %v", got)
	}

	if err := store.FeedItems().MarkFolderRead(ctx, folder.ID, boundary); err != nil {
		t.Fatalf("mark folder read: %v", err)
	}
	counts, err = store.FeedItems().UnreadCounts(ctx, boundary)
	if err != nil {
		t.Fatalf("unread counts after folder mark: %v", err)
	}
	if got := unreadCountMap(counts); got[feedA.ID] != 0 || got[feedB.ID] != 0 || got[outside.ID] != 1 {
		t.Fatalf("bounded counts after folder mark = %v", got)
	}

	if err := store.FeedItems().MarkAllRead(ctx, boundary); err != nil {
		t.Fatalf("mark all read: %v", err)
	}
	counts, err = store.FeedItems().UnreadCounts(ctx, boundary)
	if err != nil {
		t.Fatalf("unread counts after mark all: %v", err)
	}
	if len(counts) != 0 {
		t.Fatalf("bounded counts after mark all = %v, want empty", counts)
	}

	unbounded, err := store.FeedItems().UnreadCounts(ctx, maxTestBoundary)
	if err != nil {
		t.Fatalf("unbounded unread counts: %v", err)
	}
	if got := unreadCountMap(unbounded); got[feedA.ID] != 1 || got[feedB.ID] != 1 || got[outside.ID] != 1 {
		t.Fatalf("post-boundary items should stay unread, got %v", got)
	}
}
