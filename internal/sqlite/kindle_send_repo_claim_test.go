package sqlite

import (
	"context"
	"reader/internal/domain"
	"sync"
	"testing"
	"time"
)

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
