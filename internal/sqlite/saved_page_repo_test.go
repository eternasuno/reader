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

func TestSavedPageReadMarking(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	empty, err := store.SavedPages().Snapshot(ctx, domain.SnapshotParams{Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list empty saved pages: %v", err)
	}

	if empty == nil || len(empty) != 0 {
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

	if err := store.SavedPages().SetRead(ctx, pages[1].ID, true); err != nil {
		t.Fatalf("mark read before resetting: %v", err)
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

	unread, err := store.SavedPages().Snapshot(ctx, domain.SnapshotParams{Unread: true, Boundary: maxTestBoundary})
	if err != nil {
		t.Fatalf("list unread saved pages: %v", err)
	}

	if !slices.Equal(unread, []string{pages[1].ID, pages[0].ID}) {
		t.Fatalf("unread saved page ids = %v", unread)
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

func TestSavedPageCreateAtLimit(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.SavedPages()
	seedSavedPageRows(t, store.WriteDB(), domain.SavedPageLimit-1)

	page := domain.SavedPage{
		ID: domain.NewID(), URL: mustURL(t, "https://example.com/last"), Title: "Last", Content: "Body",
	}
	created, err := repo.Create(ctx, page)
	if err != nil || created.ID != page.ID {
		t.Fatalf("create at limit returned %q, err %v", created.ID, err)
	}

	duplicate := page
	duplicate.ID = domain.NewID()
	_, err = repo.Create(ctx, duplicate)
	conflict := requireCode(t, err, domain.ErrSavedPageAlreadyExists)
	if conflict.ID != page.ID {
		t.Fatalf("conflict id = %q, want %q", conflict.ID, page.ID)
	}

	overflow := duplicate
	overflow.URL = mustURL(t, "https://example.com/overflow")
	_, err = repo.Create(ctx, overflow)
	requireCode(t, err, domain.ErrSavedPageLimitExceeded)

	stored, err := repo.GetByID(ctx, overflow.ID)
	if err != nil || stored != nil {
		t.Fatalf("rejected page lookup returned %+v, err %v", stored, err)
	}

	ids, err := repo.Snapshot(ctx, domain.SnapshotParams{Boundary: maxTestBoundary})
	if err != nil || len(ids) != domain.SavedPageLimit {
		t.Fatalf("snapshot at limit returned %d ids, err %v", len(ids), err)
	}
}

func TestSavedPageSnapshotOverflow(t *testing.T) {
	store := newTestStore(t)
	seedSavedPageRows(t, store.WriteDB(), domain.ListSnapshotLimit+1)

	_, err := store.SavedPages().Snapshot(context.Background(), domain.SnapshotParams{Boundary: maxTestBoundary})
	requireCode(t, err, domain.ErrSavedPageRepositoryError)
}

func assertSavedPageSnapshot(t *testing.T, repo *SavedPageRepo, params domain.SnapshotParams, want []string) {
	t.Helper()

	ids, err := repo.Snapshot(context.Background(), params)
	if err != nil || !slices.Equal(ids, want) {
		t.Fatalf("snapshot returned %v, err %v, want %v", ids, err, want)
	}
}

func TestSavedPageSnapshotAndReadBoundary(t *testing.T) {
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
	createFixed(6)
	createFixed(7)

	assertSavedPageSnapshot(t, store.SavedPages(), domain.SnapshotParams{Boundary: boundary}, snapshotTestIDs(5, 4, 3, 2, 1))
	assertSavedPageSnapshot(t, store.SavedPages(), domain.SnapshotParams{Boundary: boundary, Unread: true}, snapshotTestIDs(5, 4, 3, 1))
	if err := store.SavedPages().SetRead(ctx, fixedTestID(4), true); err != nil {
		t.Fatalf("mark page 4 read: %v", err)
	}
	assertSavedPageSnapshot(t, store.SavedPages(), domain.SnapshotParams{Boundary: boundary, Unread: true, Keep: fixedTestID(2)}, snapshotTestIDs(5, 3, 2, 1))
	assertSavedPageSnapshot(t, store.SavedPages(), domain.SnapshotParams{Boundary: boundary, Unread: true, Keep: fixedTestID(7)}, snapshotTestIDs(5, 3, 1))
	if err := store.SavedPages().SetRead(ctx, fixedTestID(4), false); err != nil {
		t.Fatalf("mark page 4 unread: %v", err)
	}

	pages, err := store.SavedPages().GetByIDs(ctx, snapshotTestIDs(3, 8, 1, 5))
	if err != nil || !slices.Equal(savedPageIDs(pages), snapshotTestIDs(3, 1, 5)) {
		t.Fatalf("batch returned %v, err %v", savedPageIDs(pages), err)
	}

	empty, err := store.SavedPages().GetByIDs(ctx, snapshotTestIDs(8))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("missing batch returned %v, err %v", empty, err)
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
