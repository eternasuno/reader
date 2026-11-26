package sqlite

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"reader/internal/domain"
)

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
	ids := make([]string, 21)
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

	if len(recent) != 20 {
		t.Fatalf("recent sends = %d, want %d", len(recent), 20)
	}

	if recent[0].ID != ids[20] || recent[len(recent)-1].ID != ids[1] {
		t.Fatalf("recent sends range = %s..%s", recent[len(recent)-1].ID, recent[0].ID)
	}

	var stored int
	if err := store.ReadDB().QueryRowContext(ctx, `SELECT COUNT(*) FROM kindle_send`).Scan(&stored); err != nil {
		t.Fatalf("count kindle sends: %v", err)
	}

	if stored != 20 {
		t.Fatalf("stored kindle sends = %d, want %d", stored, 20)
	}
}

func TestKindleSendRepoPruneKeepsRunningSendWithNewerHistory(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()
	configureKindleDeliveryForTest(t, store, domain.KindleSettings{KindleEmail: "reader@kindle.com"})

	page, err := store.SavedPages().Create(ctx, domain.SavedPage{
		ID:      domain.NewID(),
		URL:     mustURL(t, "https://example.com/saved/"+domain.NewID()),
		Title:   "Saved",
		Content: "<p>body</p>",
	})
	if err != nil {
		t.Fatalf("create saved page: %v", err)
	}

	now := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)
	for i := range kindleSendLimit {
		future := now.Add(time.Duration(i+1) * time.Minute)
		claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), future)
		if err != nil {
			t.Fatalf("claim seeded send %d: %v", i, err)
		}

		if err := repo.CompleteSend(ctx, claimed.Record.ID, domain.KindleStatusSucceeded, nil, future.Add(30*time.Second)); err != nil {
			t.Fatalf("complete seeded send %d: %v", i, err)
		}
	}

	claimed, err := repo.ClaimManualSend(ctx, domain.NewID(), now)
	if err != nil {
		t.Fatalf("claim new send: %v", err)
	}

	var status string
	if err := store.ReadDB().QueryRowContext(ctx, `SELECT status FROM kindle_send WHERE id = ?`, claimed.Record.ID).Scan(&status); err != nil {
		t.Fatalf("running send missing after claim: %v", err)
	}

	if status != string(domain.KindleStatusRunning) {
		t.Fatalf("running send status = %q, want running", status)
	}

	if err := repo.RecordBookAccepted(ctx, claimed.Record.ID, 0, []string{page.ID}, nil, 1); err != nil {
		t.Fatalf("record accepted book on running send: %v", err)
	}

	if err := repo.CompleteSend(ctx, claimed.Record.ID, domain.KindleStatusSucceeded, nil, now.Add(30*time.Second)); err != nil {
		t.Fatalf("complete running send: %v", err)
	}

	gotPage, err := store.SavedPages().GetByID(ctx, page.ID)
	if err != nil || gotPage == nil || !gotPage.Read {
		t.Fatalf("saved page after accepted send = (%+v, %v), want read", gotPage, err)
	}

	if err := repo.CompleteSend(ctx, domain.NewID(), domain.KindleStatusSucceeded, nil, now); !errors.Is(err, domain.ErrKindleSendNotFound) {
		t.Fatalf("completing nonexistent send: got %v, want ErrKindleSendNotFound", err)
	}

	if err := repo.RecordBookAccepted(ctx, domain.NewID(), 0, nil, nil, 1); !errors.Is(err, domain.ErrKindleSendNotFound) {
		t.Fatalf("recording book on nonexistent send: got %v, want ErrKindleSendNotFound", err)
	}

	if err := repo.RecordBookAccepted(ctx, claimed.Record.ID, 1, nil, nil, 1); !errors.Is(err, domain.ErrKindleSendNotFound) {
		t.Fatalf("recording book on completed send: got %v, want ErrKindleSendNotFound", err)
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

	if err := store.Feeds().UpdateReaderMode(ctx, alpha.ID, domain.ReaderModeExtracted); err != nil {
		t.Fatalf("update alpha reader mode: %v", err)
	}

	alphaItems := addItems(t, store, alpha, 3)
	zetaItems := addItems(t, store, zeta, 2)
	readItems := addItems(t, store, readFeed, 2)

	if err := store.FeedItems().MarkFeedRead(ctx, readFeed.ID, maxTestBoundary); err != nil {
		t.Fatalf("mark read feed read: %v", err)
	}

	refs, err := store.KindleSends().ListUnreadForKindle(ctx)
	if err != nil {
		t.Fatalf("list unread for kindle: %v", err)
	}

	wantPages := []string{savedPages[0].ID, savedPages[2].ID}
	slices.Sort(wantPages)

	wantRefs := []domain.KindleArticleRef{
		{ID: wantPages[0], IsSavedPage: true},
		{ID: wantPages[1], IsSavedPage: true},
		{ID: alphaItems[0].ID},
		{ID: alphaItems[1].ID},
		{ID: alphaItems[2].ID},
		{ID: zetaItems[1].ID},
		{ID: zetaItems[0].ID},
	}

	if !slices.Equal(refs, wantRefs) {
		t.Fatalf("unread refs = %+v, want %+v", refs, wantRefs)
	}

	_ = empty
	if len(readItems) != 2 {
		t.Fatalf("read feed items = %d, want 2", len(readItems))
	}

	gotPage, gotFeed, gotItem, err := store.KindleSends().GetKindleArticle(ctx, wantRefs[0])
	if err != nil {
		t.Fatalf("get saved page article: %v", err)
	}
	if gotPage == nil || gotPage.ID != wantPages[0] || gotPage.Content != "<p>body</p>" || gotFeed != nil || gotItem != nil {
		t.Fatalf("get saved page article = (%+v, %+v, %+v)", gotPage, gotFeed, gotItem)
	}

	gotPage, gotFeed, gotItem, err = store.KindleSends().GetKindleArticle(ctx, wantRefs[2])
	if err != nil {
		t.Fatalf("get feed item article: %v", err)
	}
	if gotPage != nil || gotFeed == nil || gotFeed.ID != alpha.ID || gotFeed.Title != "Alpha" || gotFeed.ReaderMode != domain.ReaderModeExtracted || gotItem == nil || gotItem.ID != alphaItems[0].ID {
		t.Fatalf("get feed item article = (%+v, %+v, %+v)", gotPage, gotFeed, gotItem)
	}

	missingPage, missingFeed, missingItem, err := store.KindleSends().GetKindleArticle(ctx, domain.KindleArticleRef{ID: domain.NewID(), IsSavedPage: true})
	if err != nil || missingPage != nil || missingFeed != nil || missingItem != nil {
		t.Fatalf("missing saved page = (%+v, %+v, %+v, %v), want all nil", missingPage, missingFeed, missingItem, err)
	}

	missingPage, missingFeed, missingItem, err = store.KindleSends().GetKindleArticle(ctx, domain.KindleArticleRef{ID: domain.NewID()})
	if err != nil || missingPage != nil || missingFeed != nil || missingItem != nil {
		t.Fatalf("missing feed item = (%+v, %+v, %+v, %v), want all nil", missingPage, missingFeed, missingItem, err)
	}

	if err := store.Feeds().Delete(ctx, alpha.ID); err != nil {
		t.Fatalf("delete alpha feed: %v", err)
	}

	deletedPage, deletedFeed, deletedItem, err := store.KindleSends().GetKindleArticle(ctx, wantRefs[2])
	if err != nil || deletedPage != nil || deletedFeed != nil || deletedItem != nil {
		t.Fatalf("deleted feed article = (%+v, %+v, %+v, %v), want all nil", deletedPage, deletedFeed, deletedItem, err)
	}
}
