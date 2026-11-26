package sqlite

import (
	"context"
	"reader/internal/domain"
	"sync"
	"testing"
	"time"
)

func requireLastScheduledStartedAt(t *testing.T, repo *KindleSendRepo, want *time.Time) {
	t.Helper()

	got, err := repo.LastScheduledStartedAt(context.Background())
	if err != nil {
		t.Fatalf("last scheduled started at: %v", err)
	}

	if (got == nil) != (want == nil) || (got != nil && !got.Equal(*want)) {
		t.Fatalf("last scheduled started at = %v, want %v", got, want)
	}
}

func requireNoKindleSends(t *testing.T, repo *KindleSendRepo) {
	t.Helper()

	recent, err := repo.ListRecent(context.Background())
	if err != nil {
		t.Fatalf("list recent sends: %v", err)
	}

	if len(recent) != 0 {
		t.Fatalf("kindle sends = %+v, want none", recent)
	}
}

func configureDailyScheduleForTest(t *testing.T, store *Store, schedule domain.KindleSchedule, setAt time.Time) {
	t.Helper()

	configureKindleDeliveryForTest(t, store, domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		Schedule:    &schedule,
	}, setAt)
}

func TestKindleSendRepoClaimDueSendNeverWritesWhileLocalSlotBusy(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	now := time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC)
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, now.Add(-2*time.Hour))

	// The previous job already committed its terminal status (no running row) but
	// has not released the in-process slot yet.
	busy, err := repo.ClaimDueSend(ctx, domain.NewID(), now, true)
	if err != nil {
		t.Fatalf("ClaimDueSend() with busy slot error = %v", err)
	}

	if busy.Claimed {
		t.Fatalf("ClaimDueSend() claimed while the local slot was busy: %+v", busy)
	}

	requireNoKindleSends(t, repo)
	requireLastScheduledStartedAt(t, repo, nil)

	// The occurrence was not consumed: once the slot is free the next claim inserts exactly one running row.
	claimed, err := repo.ClaimDueSend(ctx, domain.NewID(), now.Add(time.Minute), false)
	if err != nil {
		t.Fatalf("ClaimDueSend() with free slot error = %v", err)
	}

	if !claimed.Claimed || claimed.Record.Trigger != domain.KindleTriggerScheduled || claimed.Record.Status != domain.KindleStatusRunning {
		t.Fatalf("ClaimDueSend() with free slot = %+v, want a running scheduled claim", claimed)
	}

	recent, err := repo.ListRecent(ctx)
	if err != nil {
		t.Fatalf("list recent sends after claim: %v", err)
	}

	if len(recent) != 1 || recent[0].ID != claimed.Record.ID || recent[0].Status != domain.KindleStatusRunning {
		t.Fatalf("recent sends after claim = %+v, want the single running claim", recent)
	}
}

func TestKindleSendRepoClaimDueSendFiresEachOccurrenceOnce(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	at := func(day, hour, minute int) time.Time { return time.Date(2024, 5, day, hour, minute, 0, 0, time.UTC) }
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, at(1, 8, 0))

	steps := []struct {
		name        string
		now         time.Time
		wantClaimed bool
	}{
		{"before the first occurrence", at(1, 8, 30), false},
		{"at the first occurrence", at(1, 9, 0), true},
		{"after the occurrence was claimed", at(1, 9, 30), false},
		{"one minute before the next occurrence", at(2, 8, 59), false},
		{"at the next occurrence", at(2, 9, 0), true},
		{"after three missed days fires once", at(5, 12, 0), true},
		{"right after the catch-up", at(5, 12, 1), false},
		{"at the following occurrence", at(6, 9, 0), true},
	}

	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			claimed, err := repo.ClaimDueSend(ctx, domain.NewID(), step.now, false)
			if err != nil {
				t.Fatalf("ClaimDueSend() error = %v", err)
			}

			if claimed.Claimed != step.wantClaimed {
				t.Fatalf("ClaimDueSend() claimed = %v, want %v", claimed.Claimed, step.wantClaimed)
			}

			if !claimed.Claimed {
				return
			}

			requireLastScheduledStartedAt(t, repo, &step.now)

			if err := repo.CompleteSend(ctx, claimed.Record.ID, domain.KindleStatusSucceeded, nil, step.now); err != nil {
				t.Fatalf("complete send: %v", err)
			}
		})
	}
}

func TestKindleSendRepoClaimDueSendAnchorsOnLaterOfScheduleChangeAndLastSend(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	at := func(day, hour, minute int) time.Time { return time.Date(2024, 5, day, hour, minute, 0, 0, time.UTC) }
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, at(1, 7, 0))

	first, err := repo.ClaimDueSend(ctx, domain.NewID(), at(1, 9, 0), false)
	if err != nil || !first.Claimed {
		t.Fatalf("ClaimDueSend() = (%+v, %v), want a claim", first, err)
	}

	if err := repo.CompleteSend(ctx, first.Record.ID, domain.KindleStatusSucceeded, nil, at(1, 9, 1)); err != nil {
		t.Fatalf("complete send: %v", err)
	}

	// The 09:30 occurrence of day 2 is newer than the last scheduled send but
	// older than the schedule change, so it must not fire retroactively.
	changed := domain.KindleSettings{KindleEmail: "reader@kindle.com", Schedule: &domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "UTC"}}
	if err := store.Settings().UpdateKindle(ctx, changed, at(2, 10, 0)); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	stale, err := repo.ClaimDueSend(ctx, domain.NewID(), at(2, 10, 1), false)
	if err != nil {
		t.Fatalf("ClaimDueSend() after schedule change error = %v", err)
	}

	if stale.Claimed {
		t.Fatalf("ClaimDueSend() fired an occurrence older than the schedule change: %+v", stale)
	}

	next, err := repo.ClaimDueSend(ctx, domain.NewID(), at(3, 9, 30), false)
	if err != nil || !next.Claimed {
		t.Fatalf("ClaimDueSend() at the new schedule time = (%+v, %v), want a claim", next, err)
	}
}

func TestKindleSendRepoClaimDueSendUsesStoredTimezone(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	// 09:00 in Asia/Shanghai (UTC+8, no DST) is 01:00 UTC.
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "Asia/Shanghai"}, time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC))

	early, err := repo.ClaimDueSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 0, 59, 0, 0, time.UTC), false)
	if err != nil || early.Claimed {
		t.Fatalf("ClaimDueSend() before 09:00 local = (%+v, %v), want no claim", early, err)
	}

	due, err := repo.ClaimDueSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 1, 0, 0, 0, time.UTC), false)
	if err != nil || !due.Claimed {
		t.Fatalf("ClaimDueSend() at 09:00 local = (%+v, %v), want a claim", due, err)
	}

	if due.ScheduleLocation == nil || due.ScheduleLocation.String() != "Asia/Shanghai" {
		t.Fatalf("claimed schedule location = %v, want Asia/Shanghai", due.ScheduleLocation)
	}
}

func TestKindleSendRepoClaimDueSendSkipsUnusableSettings(t *testing.T) {
	now := time.Date(2024, 5, 3, 12, 0, 0, 0, time.UTC)
	setAt := time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		configure func(t *testing.T, store *Store)
	}{
		{"kindle not configured", func(*testing.T, *Store) {}},
		{"schedule off", func(t *testing.T, store *Store) { configureManualKindleForTest(t, store) }},
		{"smtp removed", func(t *testing.T, store *Store) {
			configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, setAt)
			if err := store.Settings().DeleteSMTP(context.Background()); err != nil {
				t.Fatalf("delete smtp: %v", err)
			}
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t)
			tc.configure(t, store)

			claimed, err := store.KindleSends().ClaimDueSend(context.Background(), domain.NewID(), now, false)
			if err != nil || claimed.Claimed {
				t.Fatalf("ClaimDueSend() = (%+v, %v), want no claim and no error", claimed, err)
			}

			requireNoKindleSends(t, store.KindleSends())
		})
	}
}

func TestKindleSendRepoClaimDueSendReportsCorruptStoredScheduleAsRepositoryError(t *testing.T) {
	now := time.Date(2024, 5, 3, 12, 0, 0, 0, time.UTC)

	for name, assignment := range corruptScheduleAssignments {
		t.Run(name, func(t *testing.T) {
			store := newTestStore(t)
			configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC))
			corruptStoredSchedule(t, store, assignment)

			claimed, err := store.KindleSends().ClaimDueSend(context.Background(), domain.NewID(), now, false)
			requireCode(t, err, domain.ErrSettingRepositoryError)

			if claimed.Claimed {
				t.Fatalf("ClaimDueSend() claimed a send from a corrupt schedule: %+v", claimed)
			}

			requireNoKindleSends(t, store.KindleSends())
		})
	}
}

func TestKindleSendRepoClaimDueSendRaceWithSettingsUpdate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	now := time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC)
	configureKindleDeliveryForTest(t, store, domain.KindleSettings{
		KindleEmail: "old@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"},
	}, now.Add(-2*time.Hour))

	updated := domain.KindleSettings{
		KindleEmail: "new@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 15, Minute: 0, Timezone: "UTC"},
	}

	start := make(chan struct{})
	var wg sync.WaitGroup
	var claim domain.ClaimedKindleSend
	var claimErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		claim, claimErr = store.KindleSends().ClaimDueSend(ctx, domain.NewID(), now, false)
	}()
	go func() {
		defer wg.Done()
		<-start
		if err := store.Settings().UpdateKindle(ctx, updated, now); err != nil {
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

	if settings.Kindle == nil {
		t.Fatal("kindle settings are missing")
	}

	assertKindleSettings(t, *settings.Kindle, updated)

	if claim.Claimed {
		// ClaimDueSend committed before UpdateKindle: its snapshot holds the old settings.
		if claim.Delivery.KindleEmail != "old@kindle.com" {
			t.Fatalf("claimed email = %q, want old@kindle.com", claim.Delivery.KindleEmail)
		}

		return
	}

	// UpdateKindle committed first: the new schedule had no due occurrence, so nothing was written.
	requireNoKindleSends(t, store.KindleSends())
}

func TestKindleSendRepoClaimSnapshotsDelivery(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	configureKindleDeliveryForTest(t, store, domain.KindleSettings{KindleEmail: "old@kindle.com"}, time.Time{})

	claimed, err := store.KindleSends().ClaimManualSend(ctx, domain.NewID(), time.Date(2024, 5, 1, 9, 30, 0, 0, time.UTC))
	if err != nil || !claimed.Claimed {
		t.Fatalf("ClaimManualSend() = (%+v, %v), want a claim", claimed, err)
	}

	if err := store.Settings().UpdateKindle(ctx, domain.KindleSettings{KindleEmail: "new@kindle.com"}, time.Time{}); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	if err := store.Settings().UpdateSMTP(ctx, domain.SMTPSettings{
		SenderEmail: "other@example.com",
		Host:        "smtp.other.example.com",
		Port:        465,
		Security:    domain.SMTPSecurityTLS,
	}); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	delivery := claimed.Delivery
	if delivery.KindleEmail != "old@kindle.com" || delivery.SMTP.Host != "smtp.example.com" {
		t.Fatalf("claimed delivery = %+v, want the settings snapshotted at claim time", delivery)
	}
}
