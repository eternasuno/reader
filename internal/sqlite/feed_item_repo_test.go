package sqlite

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"reader/internal/domain"
)

func TestFeedItemListAllPaging(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	empty, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list empty items: %v", err)
	}

	if empty.Items == nil || len(empty.Items) != 0 || empty.Cursor != nil {
		t.Fatalf("empty page = %+v", empty)
	}

	feed := createFeed(t, store, "Example", nil)
	items := addItems(t, store, feed, 5)

	first, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}

	if got := itemIDs(first.Items); !slices.Equal(got, []string{items[4].ID, items[3].ID}) {
		t.Fatalf("first page ids = %v", got)
	}

	if first.Cursor == nil || *first.Cursor != items[3].ID {
		t.Fatalf("first page cursor = %v, want %s", first.Cursor, items[3].ID)
	}

	second, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: first.Cursor, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}

	if got := itemIDs(second.Items); !slices.Equal(got, []string{items[2].ID, items[1].ID}) {
		t.Fatalf("second page ids = %v", got)
	}

	if second.Cursor == nil || *second.Cursor != items[1].ID {
		t.Fatalf("second page cursor = %v, want %s", second.Cursor, items[1].ID)
	}

	third, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: second.Cursor, Boundary: maxTestBoundary})
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

	unread, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 10, Unread: true, Boundary: maxTestBoundary})
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

	newest, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 2, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list newest page: %v", err)
	}

	if got := itemIDs(newest.Items); !slices.Equal(got, []string{items[4].ID, items[3].ID}) {
		t.Fatalf("newest page ids = %v", got)
	}

	oldest, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 2, Order: domain.SortOrderOldest, Boundary: maxTestBoundary})
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
		Limit:    2,
		Order:    domain.SortOrderOldest,
		Cursor:   oldest.Cursor,
		Boundary: maxTestBoundary,
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

	unread, err := store.FeedItems().ListByFeed(ctx, feed.ID, domain.PageParams{Limit: 10, Unread: true, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list unread feed items: %v", err)
	}

	if got := itemIDs(unread.Items); !slices.Equal(got, []string{items[4].ID, items[2].ID, items[1].ID, items[0].ID}) {
		t.Fatalf("unread feed item ids = %v", got)
	}

	unknown, err := store.FeedItems().ListByFeed(ctx, "missing", domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
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

	firstPage, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 3, Boundary: maxTestBoundary})
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

	nextPage, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 3, Cursor: firstPage.Cursor, Boundary: maxTestBoundary})
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

	unread, err := store.FeedItems().ListByFolder(ctx, folder.ID, domain.PageParams{Limit: 10, Unread: true, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list unread folder items: %v", err)
	}

	if got := itemIDs(unread.Items); !slices.Equal(got, []string{secondItems[1].ID, firstItems[1].ID, firstItems[0].ID}) {
		t.Fatalf("unread folder item ids = %v", got)
	}

	missing, err := store.FeedItems().ListByFolder(ctx, "missing", domain.PageParams{Limit: 10, Boundary: maxTestBoundary})
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

			syncFeed(t, store, feed, []domain.FeedItem{item}, nil)

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
	syncFeed(t, store, feed, items, nil)

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

			var cursor *string
			for start := 0; start < len(want); start += 2 {
				end := min(start+2, len(want))
				page, err := test.list(domain.PageParams{Limit: 2, Unread: unread, Order: domain.SortOrderOldest, Cursor: cursor, Boundary: maxTestBoundary})
				if err != nil {
					t.Fatalf("%s list oldest: %v", test.name, err)
				}
				if got := itemIDs(page.Items); !slices.Equal(got, want[start:end]) {
					t.Fatalf("%s unread=%v page ids = %v, want %v", test.name, unread, got, want[start:end])
				}
				if end == len(want) {
					if page.Cursor != nil {
						t.Fatalf("%s final cursor = %v, want nil", test.name, *page.Cursor)
					}
				} else if page.Cursor == nil || *page.Cursor != want[end-1] {
					t.Fatalf("%s cursor = %v, want %s", test.name, page.Cursor, want[end-1])
				}
				cursor = page.Cursor
			}
		}
	}
}

func TestFeedItemBoundaryIsolationAndContinuation(t *testing.T) {
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
		syncFeed(t, store, feed, items, nil)
	}

	syncFixed(feedA, 1, 2, 5)
	syncFixed(feedB, 3, 6)
	syncFixed(outside, 4)

	if err := store.FeedItems().SetRead(ctx, fixedTestID(2), true); err != nil {
		t.Fatalf("mark item 2 read: %v", err)
	}

	boundary := fixedTestID(6)

	// Begin continuation in newest order, then insert items > boundary before paging further.
	page1, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Boundary: boundary})
	if err != nil {
		t.Fatalf("list all page 1: %v", err)
	}
	if got := itemIDs(page1.Items); !slices.Equal(got, []string{fixedTestID(6), fixedTestID(5)}) {
		t.Fatalf("page 1 ids = %v", got)
	}

	syncFixed(feedA, 7)
	syncFixed(feedB, 8)
	syncFixed(outside, 9)

	page2, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: page1.Cursor, Boundary: boundary})
	if err != nil {
		t.Fatalf("list all page 2: %v", err)
	}
	if got := itemIDs(page2.Items); !slices.Equal(got, []string{fixedTestID(4), fixedTestID(3)}) {
		t.Fatalf("page 2 ids = %v", got)
	}

	page3, err := store.FeedItems().ListAll(ctx, domain.PageParams{Limit: 2, Cursor: page2.Cursor, Boundary: boundary})
	if err != nil {
		t.Fatalf("list all page 3: %v", err)
	}
	if got := itemIDs(page3.Items); !slices.Equal(got, []string{fixedTestID(2), fixedTestID(1)}) || page3.Cursor != nil {
		t.Fatalf("page 3 = %v cursor=%v", itemIDs(page3.Items), page3.Cursor)
	}

	scopes := []struct {
		name   string
		list   func(domain.PageParams) (domain.PageResult[domain.FeedItem], error)
		allAsc []string
		unread []string
	}{
		{
			name: "all",
			list: func(p domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
				return store.FeedItems().ListAll(ctx, p)
			},
			allAsc: []string{fixedTestID(1), fixedTestID(2), fixedTestID(3), fixedTestID(4), fixedTestID(5), fixedTestID(6)},
			unread: []string{fixedTestID(1), fixedTestID(3), fixedTestID(4), fixedTestID(5), fixedTestID(6)},
		},
		{
			name: "feed",
			list: func(p domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
				return store.FeedItems().ListByFeed(ctx, feedA.ID, p)
			},
			allAsc: []string{fixedTestID(1), fixedTestID(2), fixedTestID(5)},
			unread: []string{fixedTestID(1), fixedTestID(5)},
		},
		{
			name: "folder",
			list: func(p domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
				return store.FeedItems().ListByFolder(ctx, folder.ID, p)
			},
			allAsc: []string{fixedTestID(1), fixedTestID(2), fixedTestID(3), fixedTestID(5), fixedTestID(6)},
			unread: []string{fixedTestID(1), fixedTestID(3), fixedTestID(5), fixedTestID(6)},
		},
	}

	for _, scope := range scopes {
		for _, order := range []domain.SortOrder{domain.SortOrderNewest, domain.SortOrderOldest} {
			for _, unreadOnly := range []bool{false, true} {
				want := slices.Clone(scope.allAsc)
				if unreadOnly {
					want = slices.Clone(scope.unread)
				}
				if order == domain.SortOrderNewest {
					slices.Reverse(want)
				}

				var collected []string
				var cursor *string
				for {
					page, err := scope.list(domain.PageParams{Limit: 2, Unread: unreadOnly, Order: order, Cursor: cursor, Boundary: boundary})
					if err != nil {
						t.Fatalf("%s order=%s unread=%v: %v", scope.name, order, unreadOnly, err)
					}
					collected = append(collected, itemIDs(page.Items)...)
					if page.Cursor == nil {
						break
					}
					cursor = page.Cursor
				}
				if !slices.Equal(collected, want) {
					t.Fatalf("%s order=%s unread=%v got %v, want %v", scope.name, order, unreadOnly, collected, want)
				}
			}
		}
	}

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
