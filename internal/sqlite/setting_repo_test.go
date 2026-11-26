package sqlite

import (
	"context"
	"testing"
	"time"

	"reader/internal/domain"
)

func TestSettingRepoProvider(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Provider != domain.ProviderDirect || settings.Retention != 100 {
		t.Fatalf("default settings = %+v", settings)
	}

	if err := repo.UpdateRetention(ctx, 250); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderJina); err != nil {
		t.Fatalf("update provider jina without key: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after jina: %v", err)
	}

	if settings.Retention != 250 || settings.Provider != domain.ProviderJina || settings.JinaKey != nil {
		t.Fatalf("settings after jina = %+v", settings)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderBrowser); err == nil {
		t.Fatal("expected a required browser endpoint error")
	} else {
		requireCode(t, err, domain.ErrBrowserEndpointRequired)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after failed browser switch: %v", err)
	}

	if settings.Provider != domain.ProviderJina || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after failed browser switch = %+v", settings)
	}

	if err := repo.UpdateBrowserEndpoint(ctx, "wss://browser.internal:3000"); err != nil {
		t.Fatalf("update browser endpoint: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderBrowser); err != nil {
		t.Fatalf("update provider browser: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after browser: %v", err)
	}

	if settings.Provider != domain.ProviderBrowser || settings.BrowserEndpoint == nil || *settings.BrowserEndpoint != "wss://browser.internal:3000" {
		t.Fatalf("settings after browser = %+v", settings)
	}

	if err := repo.DeleteBrowserEndpoint(ctx); err != nil {
		t.Fatalf("delete browser endpoint while provider=browser: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting browser endpoint: %v", err)
	}

	if settings.Provider != domain.ProviderDirect || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after deleting browser endpoint = %+v", settings)
	}

	if err := repo.UpdateBrowserEndpoint(ctx, "https://browser.internal:3001"); err != nil {
		t.Fatalf("set browser endpoint again: %v", err)
	}

	if err := repo.UpdateProvider(ctx, domain.ProviderJina); err != nil {
		t.Fatalf("switch provider to jina: %v", err)
	}

	if err := repo.DeleteBrowserEndpoint(ctx); err != nil {
		t.Fatalf("delete browser endpoint while provider=jina: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting browser endpoint under jina: %v", err)
	}

	if settings.Provider != domain.ProviderJina || settings.BrowserEndpoint != nil {
		t.Fatalf("settings after deleting browser endpoint under jina = %+v", settings)
	}
}

func TestSettingRepoServices(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	if err := repo.UpdateJinaKey(ctx, "key-1"); err != nil {
		t.Fatalf("update jina key: %v", err)
	}

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after jina key: %v", err)
	}

	if settings.JinaKey == nil || *settings.JinaKey != "key-1" {
		t.Fatalf("jina key = %v, want key-1", settings.JinaKey)
	}

	if err := repo.DeleteJinaKey(ctx); err != nil {
		t.Fatalf("delete jina key: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting jina key: %v", err)
	}

	if settings.JinaKey != nil {
		t.Fatalf("jina key after delete = %v, want nil", settings.JinaKey)
	}

	smtp := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptr("smtp-user"),
		Password:    ptr("smtp-password"),
	}

	if err := repo.UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after smtp: %v", err)
	}

	if settings.SMTP == nil {
		t.Fatal("smtp settings are missing")
	}

	if settings.Kindle != nil {
		t.Fatalf("kindle settings should be nil before UpdateKindle: %+v", settings.Kindle)
	}

	assertSMTPSettings(t, *settings.SMTP, smtp)

	smtpWithoutPassword := smtp
	smtpWithoutPassword.Password = nil
	if err := repo.UpdateSMTP(ctx, smtpWithoutPassword); err != nil {
		t.Fatalf("update smtp without password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after nil smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "smtp-password" {
		t.Fatalf("password was not preserved: %+v", settings.SMTP)
	}

	smtpWithBlankPassword := smtp
	smtpWithBlankPassword.Password = ptr("   ")
	if err := repo.UpdateSMTP(ctx, smtpWithBlankPassword); err != nil {
		t.Fatalf("update smtp with blank password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after blank smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "smtp-password" {
		t.Fatalf("password was not preserved after blank update: %+v", settings.SMTP)
	}

	rotated := smtp
	rotated.Password = ptr("rotated-password")
	if err := repo.UpdateSMTP(ctx, rotated); err != nil {
		t.Fatalf("update smtp with rotated password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after rotated smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password == nil || *settings.SMTP.Password != "rotated-password" {
		t.Fatalf("rotated password = %+v", settings.SMTP)
	}

	if err := repo.DeleteSMTPPassword(ctx); err != nil {
		t.Fatalf("delete smtp password: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting smtp password: %v", err)
	}

	if settings.SMTP == nil || settings.SMTP.Password != nil {
		t.Fatalf("smtp password after delete = %+v", settings.SMTP)
	}

	kindle := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"},
	}
	if err := repo.UpdateKindle(ctx, kindle, time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("update kindle before deleting smtp: %v", err)
	}

	if err := repo.DeleteSMTP(ctx); err != nil {
		t.Fatalf("delete smtp: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after deleting smtp: %v", err)
	}

	if settings.SMTP != nil {
		t.Fatalf("smtp after delete = %+v, want nil", settings.SMTP)
	}

	if settings.Kindle == nil {
		t.Fatal("kindle settings were cleared by DeleteSMTP")
	}

	assertKindleSettings(t, *settings.Kindle, kindle)
}

func TestSettingRepoKindle(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	now := time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC)
	kindle := domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "Asia/Shanghai"},
	}

	if err := repo.UpdateKindle(ctx, kindle, now); err == nil {
		t.Fatal("expected an SMTP not configured error")
	} else {
		requireCode(t, err, domain.ErrSMTPNotConfigured)
	}

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after rejected kindle update: %v", err)
	}

	if settings.SMTP != nil || settings.Kindle != nil {
		t.Fatalf("settings after rejected kindle update = %+v", settings)
	}

	smtp := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptr("smtp-user"),
		Password:    ptr("smtp-password"),
	}
	if err := repo.UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	if err := repo.UpdateKindle(ctx, kindle, now); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.SMTP == nil || settings.Kindle == nil {
		t.Fatalf("expected both smtp and kindle settings, got %+v", settings)
	}

	assertSMTPSettings(t, *settings.SMTP, smtp)
	assertKindleSettings(t, *settings.Kindle, kindle)
	requireScheduleUpdatedAt(t, store, &now)

	manualOnly := domain.KindleSettings{KindleEmail: "reader@kindle.com"}
	if err := repo.UpdateKindle(ctx, manualOnly, now.Add(time.Hour)); err != nil {
		t.Fatalf("update kindle without schedule: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after clearing schedule: %v", err)
	}

	if settings.Kindle == nil {
		t.Fatal("kindle settings are missing after clearing the schedule")
	}

	assertKindleSettings(t, *settings.Kindle, manualOnly)
	requireScheduleUpdatedAt(t, store, nil)

	scheduleColumnsSet := `SELECT COUNT(*) FROM setting WHERE send_hour IS NOT NULL OR send_minute IS NOT NULL OR timezone IS NOT NULL OR schedule_updated_at IS NOT NULL`
	if got := countRows(t, store, scheduleColumnsSet); got != 0 {
		t.Fatalf("schedule columns set after clearing the schedule = %d rows, want all NULL", got)
	}
}

func TestSettingRepoGetReportsCorruptStoredScheduleAsRepositoryError(t *testing.T) {
	for name, assignment := range corruptScheduleAssignments {
		t.Run(name, func(t *testing.T) {
			store := newTestStore(t)
			configureDailyScheduleForTest(t, store, domain.KindleSchedule{Hour: 9, Minute: 0, Timezone: "UTC"}, time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC))
			corruptStoredSchedule(t, store, assignment)

			_, err := store.Settings().Get(context.Background())
			requireCode(t, err, domain.ErrSettingRepositoryError)
		})
	}
}

func TestSettingRepoKindleScheduleUpdatedAt(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	configureManualKindleForTest(t, store)

	base := time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC)
	at := func(hours int) time.Time { return base.Add(time.Duration(hours) * time.Hour) }

	// Each step builds on the previous one: the rule depends on the stored state.
	steps := []struct {
		name     string
		now      time.Time
		email    string
		schedule *domain.KindleSchedule
		want     *time.Time
	}{
		{"enable schedule", at(0), "reader@kindle.com", &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"}, ptrTime(at(0))},
		{"unchanged schedule keeps the stamp", at(1), "reader@kindle.com", &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"}, ptrTime(at(0))},
		{"hour change restamps", at(2), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "UTC"}, ptrTime(at(2))},
		{"minute change restamps", at(3), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "UTC"}, ptrTime(at(3))},
		{"timezone change restamps", at(4), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, ptrTime(at(4))},
		{"email change keeps the stamp", at(5), "other@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, ptrTime(at(4))},
		{"disable clears the stamp", at(6), "other@kindle.com", nil, nil},
		{"re-enable the same schedule restamps", at(7), "other@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, ptrTime(at(7))},
	}

	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			kindle := domain.KindleSettings{
				KindleEmail: step.email,
				Schedule:    step.schedule,
				// Caller-supplied stamps are ignored: the repository owns the field.
				ScheduleUpdatedAt: ptrTime(time.Unix(1, 0)),
			}
			if err := store.Settings().UpdateKindle(ctx, kindle, step.now); err != nil {
				t.Fatalf("update kindle: %v", err)
			}

			settings, err := store.Settings().Get(ctx)
			if err != nil || settings.Kindle == nil {
				t.Fatalf("get settings: (%+v, %v)", settings, err)
			}

			assertKindleSettings(t, *settings.Kindle, kindle)
			requireScheduleUpdatedAt(t, store, step.want)
		})
	}
}
