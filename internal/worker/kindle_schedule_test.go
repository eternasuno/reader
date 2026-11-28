package worker

import (
	"context"
	"errors"
	"reader/internal/domain"
	"strings"
	"sync"
	"testing"
	"time"
)

// The daily 09:00 Asia/Shanghai occurrence on 2026-03-14 is at 01:00 UTC. A
// stored next send time at that occurrence is due for every test clock after
// it; one at the following occurrence is not.
func dueShanghaiOccurrence() time.Time {
	return time.Date(2026, 3, 14, 1, 0, 0, 0, time.UTC)
}

func nextShanghaiOccurrence() time.Time {
	return time.Date(2026, 3, 15, 1, 0, 0, 0, time.UTC)
}

func scheduledDeliverySettings(nextSendAt time.Time) domain.Settings {
	settings := configuredDeliverySettings()
	settings.Kindle.Schedule = &domain.KindleSchedule{Hour: 9, Timezone: "Asia/Shanghai"}
	settings.Kindle.NextSendAt = &nextSendAt

	return settings
}

func storedNextSendAt(t *testing.T, settings *fakeSettingRepository) time.Time {
	t.Helper()

	stored, err := settings.Get(context.Background())
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if stored.Kindle == nil || stored.Kindle.NextSendAt == nil {
		t.Fatalf("stored kindle settings = %+v, want a next send time", stored.Kindle)
	}

	return *stored.Kindle.NextSendAt
}

func TestCheckScheduleStartsDueSend(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 17, 0, 0, 0, time.UTC)

	settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{settingsRepo: settings, savedPages: []domain.SavedPage{page}}
	builder := &fakeEPUBBuilder{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	sender.Wait()

	created := sends.createdList()
	if len(created) != 1 {
		t.Fatalf("created sends = %d, want 1", len(created))
	}

	if created[0].Trigger != domain.KindleTriggerScheduled || created[0].Status != domain.KindleStatusRunning {
		t.Fatalf("created send = %+v", created[0])
	}

	if !created[0].StartedAt.Equal(now) {
		t.Fatalf("created startedAt = %v, want %v", created[0].StartedAt, now)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed sends = %+v", completed)
	}

	// The worker clock is already on 2026-03-15 in Shanghai; the book carries the
	// date of the occurrence it was claimed for.
	if got := builder.captured().dateStr; got != "2026-03-14" {
		t.Fatalf("epub date = %q, want 2026-03-14 (the claimed occurrence's date in the schedule timezone)", got)
	}

	// The claim advances the stored next send time, so the same occurrence is not due again.
	if got := storedNextSendAt(t, settings); !got.Equal(nextShanghaiOccurrence()) {
		t.Fatalf("stored next send time = %v, want %v", got, nextShanghaiOccurrence())
	}

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("second CheckSchedule() error = %v", err)
	}

	sender.Wait()

	if created := sends.createdList(); len(created) != 1 {
		t.Fatalf("created sends after second check = %d, want 1", len(created))
	}
}

func TestScheduledBookDateIgnoresClockCrossingLocalMidnightAfterClaim(t *testing.T) {
	t.Parallel()

	// The claim happens at 23:30 on 2026-03-14 in Shanghai; every later clock
	// reading is already past local midnight.
	claimedAt := time.Date(2026, 3, 14, 15, 30, 0, 0, time.UTC)
	afterMidnight := time.Date(2026, 3, 14, 16, 30, 0, 0, time.UTC)

	settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{settingsRepo: settings, savedPages: []domain.SavedPage{page}}
	builder := &fakeEPUBBuilder{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         sequenceClock(claimedAt, afterMidnight),
	})

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	sender.Wait()

	if builder.callCount() != 1 {
		t.Fatalf("epub builds = %d, want 1", builder.callCount())
	}

	if got := builder.captured().dateStr; got != "2026-03-14" {
		t.Fatalf("epub date = %q, want 2026-03-14 (the claimed occurrence's date, not the later worker clock's 2026-03-15)", got)
	}
}

func TestCheckScheduleSkipsWhenNotDueOrUnconfigured(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	cases := []struct {
		name      string
		configure func(settings *domain.Settings)
	}{
		{
			name: "missing smtp and kindle",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
				settings.Kindle = nil
			},
		},
		{
			name: "smtp configured but kindle nil",
			configure: func(settings *domain.Settings) {
				settings.Kindle = nil
			},
		},
		{
			name: "kindle configured but smtp nil",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
			},
		},
		{
			name: "next send time still in the future",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = ptrTo(nextShanghaiOccurrence())
			},
		},
		{
			name: "schedule without a stored next send time",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = nil
			},
		},
		{
			name: "scheduled sending off",
			configure: func(settings *domain.Settings) {
				settings.Kindle.Schedule = nil
				settings.Kindle.NextSendAt = nil
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			deliverySettings := scheduledDeliverySettings(dueShanghaiOccurrence())
			tc.configure(&deliverySettings)
			sends := &fakeKindleSendRepository{settingsRepo: &fakeSettingRepository{settings: deliverySettings}}

			sender := newTestKindleSender(t, KindleConfig{
				KindleSends: sends,
				Now:         func() time.Time { return now },
			})

			if err := sender.CheckSchedule(context.Background()); err != nil {
				t.Fatalf("CheckSchedule() error = %v", err)
			}

			if created := sends.createdList(); len(created) != 0 {
				t.Fatalf("created sends = %d, want 0", len(created))
			}
		})
	}
}

func TestCheckScheduleReturnsClaimError(t *testing.T) {
	t.Parallel()

	want := errors.New("claim failed")
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
	sends := &fakeKindleSendRepository{settingsRepo: settings, claimErr: want}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); !errors.Is(err, want) {
		t.Fatalf("CheckSchedule() error = %v, want %v", err, want)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after ClaimDueSend failure")
	}
}

func TestCheckScheduleDoesNotSendToOldAddressAfterSettingsChange(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := scheduledDeliverySettings(dueShanghaiOccurrence())
	deliverySettings.Kindle.KindleEmail = "old@kindle.com"

	settings := &fakeSettingRepository{settings: deliverySettings}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	mailer := &fakeMailSender{}

	sends := &fakeKindleSendRepository{
		settingsRepo: settings,
		savedPages:   []domain.SavedPage{page},
		beforeClaim: func() {
			// Simulate user editing Kindle email between scheduler wakeup and claim transaction.
			updated := *deliverySettings.Kindle
			updated.KindleEmail = "new@kindle.com"
			_ = settings.UpdateKindle(context.Background(), updated, now)
		},
	}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return []domain.EPUBBook{{SavedPageIDs: []string{"page-1"}, ArticleCount: 1}}, nil
		}},
		MailSender: mailer,
		Now:        func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	sender.Wait()

	mails := mailer.sentList()
	if len(mails) != 1 || mails[0].delivery.KindleEmail != "new@kindle.com" {
		t.Fatalf("sent mails = %+v, want delivery to new@kindle.com only", mails)
	}
}

func TestCheckScheduleDefersWhileRunningThenFiresOnLaterTick(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{settingsRepo: settings, savedPages: []domain.SavedPage{page}}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return nil, nil
	}}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for manual job to start")
	}

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() while busy error = %v", err)
	}

	created := sends.createdList()
	if len(created) != 1 || created[0].Trigger != domain.KindleTriggerManual {
		t.Fatalf("created sends = %+v, want the manual send only", created)
	}

	if got := storedNextSendAt(t, settings); !got.Equal(dueShanghaiOccurrence()) {
		t.Fatalf("stored next send time after a busy tick = %v, want %v (a busy tick must leave the schedule due)", got, dueShanghaiOccurrence())
	}

	close(release)
	sender.Wait()

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() after the manual send finished error = %v", err)
	}

	sender.Wait()

	created = sends.createdList()
	if len(created) != 2 || created[1].Trigger != domain.KindleTriggerScheduled {
		t.Fatalf("created sends = %+v, want manual then scheduled", created)
	}

	if got := storedNextSendAt(t, settings); !got.Equal(nextShanghaiOccurrence()) {
		t.Fatalf("stored next send time after the later tick = %v, want %v", got, nextShanghaiOccurrence())
	}
}

func TestCheckScheduleDoesNotOrphanRunningRowWhileJobReleasesSlot(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
	sends := &fakeKindleSendRepository{settingsRepo: settings}

	// Pause the first job after its terminal status is committed but before it
	// can take the sender mutex to release the in-process slot.
	committed := make(chan struct{})
	release := make(chan struct{})

	var pauseOnce sync.Once

	sends.afterComplete = func() {
		pauseOnce.Do(func() {
			close(committed)
			<-release
		})
	}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	select {
	case <-committed:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for the first job to commit its terminal status")
	}

	if sends.hasRunningRow() || !sender.IsRunning() {
		t.Fatalf("precondition: running row = %v, slot busy = %v, want no row and a busy slot", sends.hasRunningRow(), sender.IsRunning())
	}

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() while the slot is releasing error = %v", err)
	}

	if created := sends.createdList(); len(created) != 1 {
		t.Fatalf("created sends = %d, want 1 (manual only)", len(created))
	}

	if sends.hasRunningRow() {
		t.Fatal("CheckSchedule inserted a running row that no job will ever complete")
	}

	close(release)
	sender.Wait()

	if sender.IsRunning() || sends.hasRunningRow() {
		t.Fatalf("after release: slot busy = %v, running row = %v, want both clear", sender.IsRunning(), sends.hasRunningRow())
	}

	// The deferred occurrence is still due and starts on the freed slot.
	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() on the freed slot error = %v", err)
	}

	sender.Wait()

	created := sends.createdList()
	if len(created) != 2 || created[1].Trigger != domain.KindleTriggerScheduled {
		t.Fatalf("created sends = %+v, want manual then scheduled", created)
	}

	completed := sends.completedList()
	if len(completed) != 2 || completed[1].sendID != created[1].ID || completed[1].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed sends = %+v, want the scheduled send completed", completed)
	}

	if sender.IsRunning() || sends.hasRunningRow() {
		t.Fatalf("final state: slot busy = %v, running row = %v, want both clear", sender.IsRunning(), sends.hasRunningRow())
	}
}

func TestStartSchedulerChecksImmediately(t *testing.T) {
	t.Parallel()

	beforeDue := time.Date(2026, 3, 14, 0, 30, 0, 0, time.UTC)
	afterDue := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	for _, tc := range []struct {
		name     string
		interval time.Duration
		clock    []time.Time
	}{
		{"startup", time.Hour, []time.Time{afterDue}},
		// The startup check finds nothing due; the clock then passes the stored
		// next send time and a later tick must pick it up.
		{"periodic", 10 * time.Millisecond, []time.Time{beforeDue, afterDue}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			settings := &fakeSettingRepository{settings: scheduledDeliverySettings(dueShanghaiOccurrence())}
			completed := make(chan struct{}, 100)
			sends := &fakeKindleSendRepository{settingsRepo: settings, afterComplete: func() { completed <- struct{}{} }}
			sender := newTestKindleSender(t, KindleConfig{KindleSends: sends, EPUBBuilder: &fakeEPUBBuilder{}, MailSender: &fakeMailSender{}, TickInterval: tc.interval, Now: sequenceClock(tc.clock...)})

			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})

			go func() { sender.StartScheduler(ctx); close(done) }()

			select {
			case <-completed:
			case <-time.After(testWaitTimeout):
				cancel()
				<-done
				sender.Wait()
				t.Fatal("scheduled send did not complete")
			}

			cancel()

			select {
			case <-done:
			case <-time.After(testWaitTimeout):
				t.Fatal("StartScheduler did not return after context cancellation")
			}

			sender.Wait()

			if got := len(sends.createdList()); got != 1 {
				t.Fatalf("created sends = %d, want exactly 1 (later ticks must not resend the occurrence)", got)
			}
		})
	}
}

func TestNewKindleSenderDefaultsToOneMinuteScheduleTick(t *testing.T) {
	t.Parallel()

	sender := newTestKindleSender(t, KindleConfig{})

	if sender.tickInterval != time.Minute {
		t.Fatalf("default tick interval = %v, want %v", sender.tickInterval, time.Minute)
	}
}

func TestCheckScheduleLoggedConsecutiveFailuresAndReset(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrSettingRepositoryError, errors.New("db error for https://alice:secret@example.com/db"))
	settings := &fakeSettingRepository{}
	sends := &fakeKindleSendRepository{settingsRepo: settings}

	var fatals fatalRecorder

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		OnFatal:     fatals.Record,
	})

	// Direct CheckSchedule errors do not increment the scheduler streak.
	sends.setClaimError(dbErr)
	for range 3 {
		if err := sender.CheckSchedule(context.Background()); !errors.Is(err, dbErr) {
			t.Fatalf("CheckSchedule() error = %v, want %v", err, dbErr)
		}
	}

	if got := fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls after direct CheckSchedule = %d, want 0", got)
	}

	// Two consecutive failures followed by success (not claimed) resets the counter.
	sender.checkScheduleLogged(context.Background())
	sender.checkScheduleLogged(context.Background())
	sends.setClaimError(nil)
	sender.checkScheduleLogged(context.Background())

	if got := fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls after 2 failures + reset = %d, want 0", got)
	}

	// Three consecutive failures trigger OnFatal exactly once (4th stays 1).
	sends.setClaimError(dbErr)
	for range 4 {
		sender.checkScheduleLogged(context.Background())
	}

	got := fatals.Errors()
	if len(got) != 1 {
		t.Fatalf("OnFatal calls = %d, want 1", len(got))
	}

	if !errors.Is(got[0], dbErr) {
		t.Fatalf("fatal error = %v, want wrapping %v", got[0], dbErr)
	}

	if !strings.Contains(got[0].Error(), "3") {
		t.Fatalf("fatal error %q missing consecutive failure count", got[0].Error())
	}

	if strings.Contains(got[0].Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", got[0].Error())
	}
}

func TestCheckScheduleLoggedIgnoresCanceledFailures(t *testing.T) {
	t.Parallel()

	dbErr := domain.NewError(domain.ErrSettingRepositoryError, errors.New("schedule query failed"))
	settings := &fakeSettingRepository{}
	sends := &fakeKindleSendRepository{settingsRepo: settings}

	var fatals fatalRecorder

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		OnFatal:     fatals.Record,
	})

	// Repeated context.Canceled errors never trigger OnFatal.
	sends.setClaimError(context.Canceled)
	for range 5 {
		sender.checkScheduleLogged(context.Background())
	}

	if got := fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls after context.Canceled = %d, want 0", got)
	}

	// Two real failures, then canceled calls (both context.Canceled and canceled ctx),
	// leave the streak at 2 so one more real failure reaches 3.
	sends.setClaimError(dbErr)
	sender.checkScheduleLogged(context.Background())
	sender.checkScheduleLogged(context.Background())

	sends.setClaimError(context.Canceled)
	sender.checkScheduleLogged(context.Background())

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	sends.setClaimError(dbErr)
	sender.checkScheduleLogged(canceledCtx)

	if got := fatals.Count(); got != 0 {
		t.Fatalf("OnFatal calls before 3rd live failure = %d, want 0", got)
	}

	sender.checkScheduleLogged(context.Background())

	if got := fatals.Count(); got != 1 {
		t.Fatalf("OnFatal calls on 3rd live failure = %d, want 1", got)
	}
}

func TestCheckScheduleLoggedNeverFatalForNonDatabaseErrors(t *testing.T) {
	t.Parallel()

	sends := &fakeKindleSendRepository{settingsRepo: &fakeSettingRepository{}}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
	})

	validationErr := domain.NewError(domain.ErrInvalidKindleSetting, errors.New("stored send time invalid"))
	for _, failure := range []error{validationErr, errors.New("unclassified")} {
		sends.setClaimError(failure)
		for range 10 {
			sender.checkScheduleLogged(context.Background())
		}
	}
}
