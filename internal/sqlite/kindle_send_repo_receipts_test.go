package sqlite

import (
	"context"
	"fmt"
	"reader/internal/domain"
	"testing"
	"time"
)

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

	configureManualKindleForTest(t, store)

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("claim manual send: %v", err)
	}
	send := claimed.Record

	if err := repo.RecordBookAccepted(ctx, send.ID, 0, []string{savedPages[0].ID}, []string{feedItems[0].ID}, 2); err != nil {
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

	if err := repo.RecordBookAccepted(ctx, send.ID, 1, nil, []string{feedItems[1].ID}, 1); err != nil {
		t.Fatalf("record second accepted book: %v", err)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 1 || recent[0].ArticleCount != 3 || recent[0].BookCount != 2 {
		t.Fatalf("send counters = %+v, want 3 articles and 2 books", recent)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, 2, nil, nil, 0); err != nil {
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

func TestKindleSendRepoRecordBookAcceptedIdempotentPerBookIndex(t *testing.T) {
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

	configureManualKindleForTest(t, store)

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("claim manual send: %v", err)
	}
	send := claimed.Record

	if err := repo.RecordBookAccepted(ctx, send.ID, 0, []string{savedPages[0].ID}, []string{feedItems[0].ID}, 2); err != nil {
		t.Fatalf("record first book: %v", err)
	}

	// Duplicate call with the same book index must not double-count or apply marks.
	if err := repo.RecordBookAccepted(ctx, send.ID, 0, []string{savedPages[1].ID}, []string{feedItems[1].ID}, 2); err != nil {
		t.Fatalf("duplicate record same book index: %v", err)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after duplicate: %v", err)
	}

	if len(recent) != 1 || recent[0].ArticleCount != 2 || recent[0].BookCount != 1 {
		t.Fatalf("send counters after duplicate = %+v, want 2 articles and 1 book", recent)
	}

	untouchedPage, err := store.SavedPages().GetByID(ctx, savedPages[1].ID)
	if err != nil || untouchedPage == nil || untouchedPage.Read {
		t.Fatalf("second saved page after duplicate = (%+v, %v), want unread", untouchedPage, err)
	}

	untouchedItem, err := store.FeedItems().GetByID(ctx, feedItems[1].ID)
	if err != nil || untouchedItem == nil || untouchedItem.Read {
		t.Fatalf("second feed item after duplicate = (%+v, %v), want unread", untouchedItem, err)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, 1, []string{savedPages[1].ID}, []string{feedItems[1].ID}, 2); err != nil {
		t.Fatalf("record different book index: %v", err)
	}

	recent, err = repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after second book: %v", err)
	}

	if len(recent) != 1 || recent[0].ArticleCount != 4 || recent[0].BookCount != 2 {
		t.Fatalf("send counters after second book = %+v, want 4 articles and 2 books", recent)
	}

	secondPage, err := store.SavedPages().GetByID(ctx, savedPages[1].ID)
	if err != nil || secondPage == nil || !secondPage.Read {
		t.Fatalf("second saved page = (%+v, %v), want read", secondPage, err)
	}

	secondItem, err := store.FeedItems().GetByID(ctx, feedItems[1].ID)
	if err != nil || secondItem == nil || !secondItem.Read {
		t.Fatalf("second feed item = (%+v, %v), want read", secondItem, err)
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

	configureManualKindleForTest(t, store)

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

	if err := repo.RecordBookAccepted(ctx, domain.NewID(), 0, []string{savedPage.ID}, []string{feedItems[0].ID}, 1); err == nil {
		t.Fatal("expected an error for a missing send")
	}

	assertUnread("missing send")

	if err := repo.CompleteSend(ctx, send.ID, domain.KindleStatusSucceeded, nil, time.Date(2024, 5, 1, 8, 5, 0, 0, time.UTC)); err != nil {
		t.Fatalf("complete send: %v", err)
	}

	if err := repo.RecordBookAccepted(ctx, send.ID, 0, []string{savedPage.ID}, []string{feedItems[0].ID}, 1); err == nil {
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
