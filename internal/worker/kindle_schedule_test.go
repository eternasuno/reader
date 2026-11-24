package worker

import (
	"context"
	"errors"
	"reader/internal/domain"
	"sync"
	"testing"
	"time"
)

func TestCheckScheduleStartsDueSend(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("CST", 8*60*60)
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{settingsRepo: settings}

	sender := NewKindleSender(KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		Location:    loc,
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	sender.Wait()

	wantNext := time.Date(2026, 3, 15, 1, 0, 0, 0, time.UTC)
	advances := sends.advanceList()
	if len(advances) != 1 || !advances[0].Equal(wantNext) {
		t.Fatalf("advances = %v, want [%v]", advances, wantNext)
	}

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
}

func TestCheckScheduleSkipsWhenNotDueOrUnconfigured(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("CST", 8*60*60)
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	configured := func() domain.Settings {
		settings := configuredDeliverySettings()
		settings.Kindle.SendTime = ptrTo("09:00")
		settings.Kindle.NextSendAt = &past

		return settings
	}

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
			name: "blank kindle email",
			configure: func(settings *domain.Settings) {
				settings.Kindle.KindleEmail = " "
			},
		},
		{
			name: "blank smtp host",
			configure: func(settings *domain.Settings) {
				settings.SMTP.Host = " "
			},
		},
		{
			name: "next send at in the future",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = &future
			},
		},
		{
			name: "missing send time",
			configure: func(settings *domain.Settings) {
				settings.Kindle.SendTime = nil
			},
		},
		{
			name: "missing next send at",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = nil
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			deliverySettings := configured()
			tc.configure(&deliverySettings)
			settings := &fakeSettingRepository{settings: deliverySettings}
			sends := &fakeKindleSendRepository{settingsRepo: settings}

			sender := NewKindleSender(KindleConfig{
				KindleSends: sends,
				Location:    loc,
				Now:         func() time.Time { return now },
			})

			if err := sender.CheckSchedule(context.Background()); err != nil {
				t.Fatalf("CheckSchedule() error = %v", err)
			}

			if advances := sends.advanceList(); len(advances) != 0 {
				t.Fatalf("advances = %v, want none", advances)
			}

			if created := sends.createdList(); len(created) != 0 {
				t.Fatalf("created sends = %d, want 0", len(created))
			}
		})
	}
}

func TestCheckScheduleReturnsInvalidSendTimeError(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("25:99")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Minute))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{settingsRepo: settings}

	sender := NewKindleSender(KindleConfig{
		KindleSends: sends,
		Now:         func() time.Time { return now },
	})

	err := sender.CheckSchedule(context.Background())
	requireErrorCode(t, err, domain.ErrInvalidKindleSetting)

	if advances := sends.advanceList(); len(advances) != 0 {
		t.Fatalf("advances = %v, want none", advances)
	}

	if created := sends.createdList(); len(created) != 0 {
		t.Fatalf("created sends = %d, want 0", len(created))
	}
}

func TestCheckScheduleReturnsClaimError(t *testing.T) {
	t.Parallel()

	want := errors.New("claim failed")
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{settingsRepo: settings, claimErr: want}

	sender := NewKindleSender(KindleConfig{
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
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.KindleEmail = "old@kindle.com"
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	mailer := &fakeMailSender{}

	sends := &fakeKindleSendRepository{
		settingsRepo: settings,
		savedPages:   []domain.SavedPage{page},
		beforeClaim: func() {
			// Simulate user editing Kindle email between scheduler wakeup and claim transaction.
			_ = settings.UpdateKindle(context.Background(), domain.KindleSettings{
				KindleEmail: "new@kindle.com",
				SendTime:    ptrTo("09:00"),
				NextSendAt:  ptrTo(now.Add(-time.Minute)),
			})
		},
	}

	sender := NewKindleSender(KindleConfig{
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
func TestCheckScheduleSkipsWhileRunning(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{settingsRepo: settings, savedPages: []domain.SavedPage{page}}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return nil, nil
	}}

	sender := NewKindleSender(KindleConfig{
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
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	if advances := sends.advanceList(); len(advances) != 1 {
		t.Fatalf("advances = %d, want 1", len(advances))
	}

	if created := sends.createdList(); len(created) != 1 {
		t.Fatalf("created sends = %d, want 1 (manual only)", len(created))
	}

	if created := sends.createdList(); created[0].Trigger != domain.KindleTriggerManual {
		t.Fatalf("created trigger = %s, want manual", created[0].Trigger)
	}

	close(release)
	sender.Wait()
}

func TestCheckScheduleDoesNotOrphanRunningRowWhileJobReleasesSlot(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	dueAt := now.Add(-time.Hour)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = &dueAt

	settings := &fakeSettingRepository{settings: deliverySettings}
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

	sender := NewKindleSender(KindleConfig{
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

	if advances := sends.advanceList(); len(advances) != 1 {
		t.Fatalf("schedule advances = %d, want 1 (the due schedule is skipped, not retried)", len(advances))
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

	// The next due claim must start normally on the freed slot.
	if err := settings.UpdateKindle(context.Background(), domain.KindleSettings{
		KindleEmail: deliverySettings.Kindle.KindleEmail,
		SendTime:    deliverySettings.Kindle.SendTime,
		NextSendAt:  &dueAt,
	}); err != nil {
		t.Fatalf("make schedule due again: %v", err)
	}

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
	for _, tc := range []struct {
		name      string
		interval  time.Duration
		keepDue   bool
		wantSends int
	}{
		{"startup", time.Hour, false, 1},
		{"periodic", 10 * time.Millisecond, true, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
			deliverySettings := configuredDeliverySettings()
			deliverySettings.Kindle.SendTime = ptrTo("09:00")
			deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))
			settings := &fakeSettingRepository{settings: deliverySettings}
			completed := make(chan struct{}, 100)
			sends := &fakeKindleSendRepository{settingsRepo: settings, keepDue: tc.keepDue, afterComplete: func() { completed <- struct{}{} }}
			sender := NewKindleSender(KindleConfig{KindleSends: sends, EPUBBuilder: &fakeEPUBBuilder{}, MailSender: &fakeMailSender{}, TickInterval: tc.interval, Now: func() time.Time { return now }})
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})
			go func() { sender.StartScheduler(ctx); close(done) }()
			for range tc.wantSends {
				select {
				case <-completed:
				case <-time.After(testWaitTimeout):
					cancel()
					<-done
					sender.Wait()
					t.Fatal("scheduled send did not complete")
				}
			}
			cancel()
			select {
			case <-done:
			case <-time.After(testWaitTimeout):
				t.Fatal("StartScheduler did not return after context cancellation")
			}
			sender.Wait()
			if got := len(sends.createdList()); got < tc.wantSends {
				t.Fatalf("created sends = %d, want at least %d", got, tc.wantSends)
			}
		})
	}
}
