package sqlite

import (
	"context"
	"sync"
	"testing"
	"time"

	"reader/internal/domain"
)

func may2024(day, hour, minute int) time.Time {
	return time.Date(2024, 5, day, hour, minute, 0, 0, time.UTC)
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

// configureDailyScheduleForTest enables the schedule as if saved at setAt, so
// its stored next send time is the first occurrence after setAt.
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

	now := may2024(1, 9, 30)
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, now.Add(-2*time.Hour))
	requireNextSendAt(t, store, ptrTime(may2024(1, 9, 0)))

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
	requireNextSendAt(t, store, ptrTime(may2024(1, 9, 0)))

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

	requireNextSendAt(t, store, ptrTime(may2024(2, 9, 0)))
}

func TestKindleSendRepoClaimDueSendFiresEachOccurrenceOnce(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 8, 0))

	steps := []struct {
		name             string
		now              time.Time
		wantScheduledFor time.Time // zero when no claim is expected
		wantNext         time.Time
	}{
		{"before the first occurrence", may2024(1, 8, 30), time.Time{}, may2024(1, 9, 0)},
		{"at the first occurrence", may2024(1, 9, 0), may2024(1, 9, 0), may2024(2, 9, 0)},
		{"after the occurrence was claimed", may2024(1, 9, 30), time.Time{}, may2024(2, 9, 0)},
		{"one minute before the next occurrence", may2024(2, 8, 59), time.Time{}, may2024(2, 9, 0)},
		{"at the next occurrence", may2024(2, 9, 0), may2024(2, 9, 0), may2024(3, 9, 0)},
		{"after three missed occurrences fires once for the latest", may2024(5, 12, 0), may2024(5, 9, 0), may2024(6, 9, 0)},
		{"right after the catch-up", may2024(5, 12, 1), time.Time{}, may2024(6, 9, 0)},
		{"at the following occurrence", may2024(6, 9, 0), may2024(6, 9, 0), may2024(7, 9, 0)},
	}

	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			claimed, err := repo.ClaimDueSend(ctx, domain.NewID(), step.now, false)
			if err != nil {
				t.Fatalf("ClaimDueSend() error = %v", err)
			}

			wantClaimed := !step.wantScheduledFor.IsZero()
			if claimed.Claimed != wantClaimed {
				t.Fatalf("ClaimDueSend() claimed = %v, want %v", claimed.Claimed, wantClaimed)
			}

			if claimed.Claimed {
				if !claimed.ScheduledFor.Equal(step.wantScheduledFor) {
					t.Fatalf("ClaimDueSend() scheduled for = %v, want %v", claimed.ScheduledFor, step.wantScheduledFor)
				}

				if err := repo.CompleteSend(ctx, claimed.Record.ID, domain.KindleStatusSucceeded, nil, step.now); err != nil {
					t.Fatalf("complete send: %v", err)
				}
			}

			requireNextSendAt(t, store, ptrTime(step.wantNext))
		})
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM kindle_send WHERE trigger = 'scheduled'`); got != 4 {
		t.Fatalf("scheduled sends = %d, want 4 (the three missed occurrences collapse into one)", got)
	}
}

func TestKindleSendRepoClaimDueSendWaitsForRunningSend(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 7, 0))

	first, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(1, 9, 0), false)
	if err != nil || !first.Claimed {
		t.Fatalf("ClaimDueSend() = (%+v, %v), want a claim", first, err)
	}

	// The first send is still running when the next occurrence arrives.
	overlap, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(2, 9, 0), false)
	if err != nil {
		t.Fatalf("ClaimDueSend() while a send runs error = %v", err)
	}

	if overlap.Claimed {
		t.Fatalf("ClaimDueSend() claimed while a send was running: %+v", overlap)
	}

	if got := countRows(t, store, `SELECT COUNT(*) FROM kindle_send`); got != 1 {
		t.Fatalf("kindle sends = %d, want only the running one", got)
	}

	requireNextSendAt(t, store, ptrTime(may2024(2, 9, 0)))

	if err := repo.CompleteSend(ctx, first.Record.ID, domain.KindleStatusSucceeded, nil, may2024(2, 9, 1)); err != nil {
		t.Fatalf("complete first send: %v", err)
	}

	later, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(2, 9, 2), false)
	if err != nil || !later.Claimed {
		t.Fatalf("ClaimDueSend() after completion = (%+v, %v), want a claim", later, err)
	}

	if !later.ScheduledFor.Equal(may2024(2, 9, 0)) {
		t.Fatalf("scheduled for = %v, want the occurrence that waited", later.ScheduledFor)
	}

	requireNextSendAt(t, store, ptrTime(may2024(3, 9, 0)))
}

func TestKindleSendRepoClaimManualSendLeavesScheduleUntouched(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 8, 0))

	manual, err := repo.ClaimManualSend(ctx, domain.NewID(), may2024(1, 10, 0))
	if err != nil || !manual.Claimed {
		t.Fatalf("ClaimManualSend() = (%+v, %v), want a claim", manual, err)
	}

	if manual.ScheduleLocation != nil || !manual.ScheduledFor.IsZero() {
		t.Fatalf("manual claim carries schedule data: %+v", manual)
	}

	// The overdue occurrence is still stored as due.
	requireNextSendAt(t, store, ptrTime(may2024(1, 9, 0)))

	if err := repo.CompleteSend(ctx, manual.Record.ID, domain.KindleStatusSucceeded, nil, may2024(1, 10, 1)); err != nil {
		t.Fatalf("complete manual send: %v", err)
	}

	scheduled, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(1, 10, 5), false)
	if err != nil || !scheduled.Claimed {
		t.Fatalf("ClaimDueSend() after manual send = (%+v, %v), want a claim", scheduled, err)
	}

	if !scheduled.ScheduledFor.Equal(may2024(1, 9, 0)) {
		t.Fatalf("scheduled for = %v, want the occurrence the manual send did not consume", scheduled.ScheduledFor)
	}
}

func TestKindleSendRepoClaimDueSendRecomputesNextSendAfterScheduleChange(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 7, 0))

	first, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(1, 9, 0), false)
	if err != nil || !first.Claimed {
		t.Fatalf("ClaimDueSend() = (%+v, %v), want a claim", first, err)
	}

	if err := repo.CompleteSend(ctx, first.Record.ID, domain.KindleStatusSucceeded, nil, may2024(1, 9, 1)); err != nil {
		t.Fatalf("complete send: %v", err)
	}

	requireNextSendAt(t, store, ptrTime(may2024(2, 9, 0)))

	// The 09:30 occurrence of day 2 is older than the schedule change, so it must not fire retroactively.
	changed := domain.KindleSettings{KindleEmail: "reader@kindle.com", Schedule: &domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "UTC"}}
	if err := store.Settings().UpdateKindle(ctx, changed, may2024(2, 10, 0)); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	requireNextSendAt(t, store, ptrTime(may2024(3, 9, 30)))

	stale, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(2, 10, 1), false)
	if err != nil {
		t.Fatalf("ClaimDueSend() after schedule change error = %v", err)
	}

	if stale.Claimed {
		t.Fatalf("ClaimDueSend() fired an occurrence older than the schedule change: %+v", stale)
	}

	next, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(3, 9, 30), false)
	if err != nil || !next.Claimed {
		t.Fatalf("ClaimDueSend() at the new schedule time = (%+v, %v), want a claim", next, err)
	}

	if !next.ScheduledFor.Equal(may2024(3, 9, 30)) {
		t.Fatalf("scheduled for = %v, want the new schedule time", next.ScheduledFor)
	}
}

func TestKindleSendRepoClaimDueSendUsesStoredTimezone(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.KindleSends()

	// 09:00 in Asia/Shanghai (UTC+8, no DST) is 01:00 UTC.
	configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "Asia/Shanghai"}, may2024(1, 0, 0))
	requireNextSendAt(t, store, ptrTime(may2024(1, 1, 0)))

	early, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(1, 0, 59), false)
	if err != nil || early.Claimed {
		t.Fatalf("ClaimDueSend() before 09:00 local = (%+v, %v), want no claim", early, err)
	}

	due, err := repo.ClaimDueSend(ctx, domain.NewID(), may2024(1, 1, 0), false)
	if err != nil || !due.Claimed {
		t.Fatalf("ClaimDueSend() at 09:00 local = (%+v, %v), want a claim", due, err)
	}

	if due.ScheduleLocation == nil || due.ScheduleLocation.String() != "Asia/Shanghai" {
		t.Fatalf("claimed schedule location = %v, want Asia/Shanghai", due.ScheduleLocation)
	}

	if !due.ScheduledFor.Equal(may2024(1, 1, 0)) {
		t.Fatalf("scheduled for = %v, want 01:00 UTC", due.ScheduledFor)
	}

	requireNextSendAt(t, store, ptrTime(may2024(2, 1, 0)))
}

func TestKindleSendRepoClaimDueSendSkipsUnusableSettings(t *testing.T) {
	now := may2024(3, 12, 0)

	tests := []struct {
		name      string
		configure func(t *testing.T, store *Store)
		wantNext  *time.Time
	}{
		{"kindle not configured", func(*testing.T, *Store) {}, nil},
		{"schedule off", func(t *testing.T, store *Store) { configureManualKindleForTest(t, store) }, nil},
		{"smtp removed", func(t *testing.T, store *Store) {
			configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 0, 0))
			if err := store.Settings().DeleteSMTP(context.Background()); err != nil {
				t.Fatalf("delete smtp: %v", err)
			}
		}, ptrTime(may2024(1, 9, 0))},
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
			requireNextSendAt(t, store, tc.wantNext)
		})
	}
}

func TestKindleSendRepoClaimDueSendReportsCorruptStoredScheduleAsRepositoryError(t *testing.T) {
	now := may2024(3, 12, 0)

	for name, assignment := range corruptScheduleAssignments {
		t.Run(name, func(t *testing.T) {
			store := newTestStore(t)
			configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, may2024(1, 0, 0))
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

	now := may2024(1, 9, 30)
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

	// Either order ends with the changed schedule armed for its next occurrence.
	requireNextSendAt(t, store, ptrTime(may2024(1, 15, 0)))

	if claim.Claimed {
		// ClaimDueSend committed before UpdateKindle: its snapshot holds the old settings.
		if claim.Delivery.KindleEmail != "old@kindle.com" || !claim.ScheduledFor.Equal(may2024(1, 9, 0)) {
			t.Fatalf("claimed email = %q, scheduled for = %v, want old@kindle.com at 09:00", claim.Delivery.KindleEmail, claim.ScheduledFor)
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

	claimed, err := store.KindleSends().ClaimManualSend(ctx, domain.NewID(), may2024(1, 9, 30))
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
