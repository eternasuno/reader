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

	id, found, err := store.SavedPages().GetIDByURL(ctx, page.URL)
	if err != nil {
		t.Fatalf("get saved page id by url: %v", err)
	}

	if !found || id != page.ID {
		t.Fatalf("saved page id by url = %q, found = %t; want %q, true", id, found, page.ID)
	}

	id, found, err = store.SavedPages().GetIDByURL(ctx, mustURL(t, "https://example.com/unknown"))
	if err != nil {
		t.Fatalf("get unknown saved page id by url: %v", err)
	}

	if found || id != "" {
		t.Fatalf("unknown saved page id = %q, found = %t; want empty, false", id, found)
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

	empty, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Boundary: maxTestBoundary})
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

	first, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list first saved page page: %v", err)
	}

	if got := savedPageIDs(first.Items); !slices.Equal(got, []string{pages[4].ID, pages[3].ID}) {
		t.Fatalf("first saved page ids = %v", got)
	}

	if first.Cursor == nil || *first.Cursor != pages[3].ID {
		t.Fatalf("first saved page cursor = %v, want %s", first.Cursor, pages[3].ID)
	}

	second, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: first.Cursor, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list second saved page page: %v", err)
	}

	if got := savedPageIDs(second.Items); !slices.Equal(got, []string{pages[2].ID, pages[1].ID}) {
		t.Fatalf("second saved page ids = %v", got)
	}

	third, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: second.Cursor, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list third saved page page: %v", err)
	}

	if got := savedPageIDs(third.Items); !slices.Equal(got, []string{pages[0].ID}) {
		t.Fatalf("third saved page ids = %v", got)
	}

	if third.Cursor != nil {
		t.Fatalf("third saved page cursor = %v, want nil", *third.Cursor)
	}

	if err := store.SavedPages().SetRead(ctx, pages[1].ID, true); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	for _, tc := range []struct {
		name   string
		order  domain.SortOrder
		unread bool
		want   []string
	}{
		{"oldest all", domain.SortOrderOldest, false, []string{pages[0].ID, pages[1].ID, pages[2].ID, pages[3].ID, pages[4].ID}},
		{"oldest unread", domain.SortOrderOldest, true, []string{pages[0].ID, pages[2].ID, pages[3].ID, pages[4].ID}},
		{"newest all", domain.SortOrderNewest, false, []string{pages[4].ID, pages[3].ID, pages[2].ID, pages[1].ID, pages[0].ID}},
		{"newest unread", domain.SortOrderNewest, true, []string{pages[4].ID, pages[3].ID, pages[2].ID, pages[0].ID}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var cursor *string
			for start := 0; start < len(tc.want); start += 2 {
				end := min(start+2, len(tc.want))
				page, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Unread: tc.unread, Order: tc.order, Cursor: cursor, Boundary: maxTestBoundary})
				if err != nil {
					t.Fatalf("list: %v", err)
				}
				if got := savedPageIDs(page.Items); !slices.Equal(got, tc.want[start:end]) {
					t.Fatalf("ids = %v, want %v", got, tc.want[start:end])
				}
				if end == len(tc.want) {
					if page.Cursor != nil {
						t.Fatalf("final cursor = %v, want nil", *page.Cursor)
					}
				} else if page.Cursor == nil || *page.Cursor != tc.want[end-1] {
					t.Fatalf("cursor = %v, want %s", page.Cursor, tc.want[end-1])
				}
				cursor = page.Cursor
			}
		})
	}

	if err := store.SavedPages().SetRead(ctx, pages[1].ID, false); err != nil {
		t.Fatalf("mark unread: %v", err)
	}

	if err := store.SavedPages().SetRead(ctx, pages[4].ID, true); err != nil {
		t.Fatalf("mark saved page read: %v", err)
	}

	if err := store.SavedPages().MarkIDsRead(ctx, []string{pages[3].ID, pages[2].ID, "missing"}); err != nil {
		t.Fatalf("mark saved page ids read: %v", err)
	}

	unread, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 10, Unread: true, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list unread saved pages: %v", err)
	}

	if got := savedPageIDs(unread.Items); !slices.Equal(got, []string{pages[1].ID, pages[0].ID}) {
		t.Fatalf("unread saved page ids = %v", got)
	}

	unreadCount, err := store.SavedPages().UnreadCount(ctx, maxTestBoundary)
	if err != nil {
		t.Fatalf("saved page unread count: %v", err)
	}

	if unreadCount != 2 {
		t.Fatalf("saved page unread count = %d, want 2", unreadCount)
	}

	if err := store.SavedPages().MarkAllRead(ctx, maxTestBoundary); err != nil {
		t.Fatalf("mark all saved pages read: %v", err)
	}

	unreadCount, err = store.SavedPages().UnreadCount(ctx, maxTestBoundary)
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

func TestSavedPageBoundaryIsolationAndContinuation(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	createFixed := func(seq uint64) {
		id := fixedTestID(seq)
		if _, err := store.SavedPages().Create(ctx, domain.SavedPage{
			ID:      id,
			URL:     mustURL(t, "https://example.com/pages/"+id),
			Title:   fmt.Sprintf("Page %d", seq),
			Content: "<p>body</p>",
		}); err != nil {
			t.Fatalf("create saved page %d: %v", seq, err)
		}
	}

	for seq := uint64(1); seq <= 5; seq++ {
		createFixed(seq)
	}
	if err := store.SavedPages().SetRead(ctx, fixedTestID(2), true); err != nil {
		t.Fatalf("mark page 2 read: %v", err)
	}

	boundary := fixedTestID(5)

	page1, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Boundary: boundary})
	if err != nil {
		t.Fatalf("list page 1: %v", err)
	}
	if got := savedPageIDs(page1.Items); !slices.Equal(got, []string{fixedTestID(5), fixedTestID(4)}) {
		t.Fatalf("page 1 ids = %v", got)
	}

	createFixed(6)
	createFixed(7)

	page2, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: page1.Cursor, Boundary: boundary})
	if err != nil {
		t.Fatalf("list page 2: %v", err)
	}
	if got := savedPageIDs(page2.Items); !slices.Equal(got, []string{fixedTestID(3), fixedTestID(2)}) {
		t.Fatalf("page 2 ids = %v", got)
	}

	page3, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Cursor: page2.Cursor, Boundary: boundary})
	if err != nil {
		t.Fatalf("list page 3: %v", err)
	}
	if got := savedPageIDs(page3.Items); !slices.Equal(got, []string{fixedTestID(1)}) || page3.Cursor != nil {
		t.Fatalf("page 3 = %v cursor=%v", savedPageIDs(page3.Items), page3.Cursor)
	}

	allAsc := []string{fixedTestID(1), fixedTestID(2), fixedTestID(3), fixedTestID(4), fixedTestID(5)}
	unreadAsc := []string{fixedTestID(1), fixedTestID(3), fixedTestID(4), fixedTestID(5)}

	for _, order := range []domain.SortOrder{domain.SortOrderNewest, domain.SortOrderOldest} {
		for _, unreadOnly := range []bool{false, true} {
			want := slices.Clone(allAsc)
			if unreadOnly {
				want = slices.Clone(unreadAsc)
			}
			if order == domain.SortOrderNewest {
				slices.Reverse(want)
			}

			var collected []string
			var cursor *string
			for {
				page, err := store.SavedPages().List(ctx, domain.PageParams{Limit: 2, Unread: unreadOnly, Order: order, Cursor: cursor, Boundary: boundary})
				if err != nil {
					t.Fatalf("order=%s unread=%v: %v", order, unreadOnly, err)
				}
				collected = append(collected, savedPageIDs(page.Items)...)
				if page.Cursor == nil {
					break
				}
				cursor = page.Cursor
			}
			if !slices.Equal(collected, want) {
				t.Fatalf("order=%s unread=%v got %v, want %v", order, unreadOnly, collected, want)
			}
		}
	}

	count, err := store.SavedPages().UnreadCount(ctx, boundary)
	if err != nil {
		t.Fatalf("bounded unread count: %v", err)
	}
	if count != 4 {
		t.Fatalf("bounded unread count = %d, want 4", count)
	}

	if err := store.SavedPages().MarkAllRead(ctx, boundary); err != nil {
		t.Fatalf("mark all read: %v", err)
	}

	count, err = store.SavedPages().UnreadCount(ctx, boundary)
	if err != nil {
		t.Fatalf("bounded unread count after mark all: %v", err)
	}
	if count != 0 {
		t.Fatalf("bounded unread count after mark all = %d, want 0", count)
	}

	unbounded, err := store.SavedPages().UnreadCount(ctx, maxTestBoundary)
	if err != nil {
		t.Fatalf("unbounded unread count: %v", err)
	}
	if unbounded != 2 {
		t.Fatalf("post-boundary unread count = %d, want 2", unbounded)
	}
}
