package sqlite

import (
	"context"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"reader/internal/domain"
)

// requireNextSendAt checks the stored next send time seen through Settings.Get
// and that a kindle_schedule row exists exactly while one is expected.
func requireNextSendAt(t *testing.T, store *Store, want *time.Time) {
	t.Helper()

	settings, err := store.Settings().Get(context.Background())
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	var got *time.Time
	if settings.Kindle != nil {
		got = settings.Kindle.NextSendAt
	}

	if (got == nil) != (want == nil) || (got != nil && !got.Equal(*want)) {
		t.Fatalf("next send at = %v, want %v", got, want)
	}

	wantRows := 0
	if want != nil {
		wantRows = 1
	}

	if rows := countRows(t, store, `SELECT COUNT(*) FROM kindle_schedule`); rows != wantRows {
		t.Fatalf("kindle_schedule rows = %d, want %d", rows, wantRows)
	}
}

func browserlessString(browserless *domain.BrowserlessSettings) string {
	if browserless == nil {
		return "nil"
	}

	token := "nil"
	if browserless.Token != nil {
		token = strconv.Quote(*browserless.Token)
	}

	return fmt.Sprintf("{url=%q token=%s residentialProxy=%t}", browserless.URL, token, browserless.ResidentialProxy)
}

func requireBrowserless(t *testing.T, repo *SettingRepo, want *domain.BrowserlessSettings) {
	t.Helper()

	settings, err := repo.Get(context.Background())
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if !reflect.DeepEqual(settings.Browserless, want) {
		t.Fatalf("browserless = %s, want %s", browserlessString(settings.Browserless), browserlessString(want))
	}
}

func TestSettingRepoRetention(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Retention != 100 || settings.Browserless != nil {
		t.Fatalf("default settings = %+v, want retention 100 and no browserless", settings)
	}

	if err := repo.UpdateRetention(ctx, 250); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	settings, err = repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings after retention: %v", err)
	}

	if settings.Retention != 250 {
		t.Fatalf("retention = %d, want 250", settings.Retention)
	}
}

func TestSettingRepoRetentionOverBudgetLeavesSettingsAndItems(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "First", nil)
	createFeed(t, store, "Second", nil)
	items := addItems(t, store, feed, 1)

	err := store.Settings().UpdateRetention(ctx, domain.FeedItemBudget/2+1)
	requireCode(t, err, domain.ErrFeedItemBudgetExceeded)

	settings, err := store.Settings().Get(ctx)
	if err != nil || settings.Retention != 100 {
		t.Fatalf("settings after budget rejection = (%+v, %v), want retention 100", settings, err)
	}

	if got := itemIDs(loadTestFeedItems(t, store, feed.ID)); !slices.Equal(got, []string{items[0].ID}) {
		t.Fatalf("items after budget rejection = %v, want original item", got)
	}
}

func TestSettingRepoLowerRetentionPrunesNewestByIDPerFeed(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	first := createFeed(t, store, "First", nil)
	second := createFeed(t, store, "Second", nil)
	addSnapshotItems(t, store, first, 1, 4, 6)
	addSnapshotItems(t, store, second, 2, 3, 5)

	for _, id := range snapshotTestIDs(6, 5) {
		if err := store.FeedItems().SetRead(ctx, id, true); err != nil {
			t.Fatalf("mark newest item read: %v", err)
		}
	}

	if err := store.Settings().UpdateRetention(ctx, 2); err != nil {
		t.Fatalf("lower retention: %v", err)
	}

	settings, err := store.Settings().Get(ctx)
	if err != nil || settings.Retention != 2 {
		t.Fatalf("settings after pruning = (%+v, %v), want retention 2", settings, err)
	}

	for _, test := range []struct {
		feed domain.Feed
		want []string
	}{
		{feed: first, want: snapshotTestIDs(6, 4)},
		{feed: second, want: snapshotTestIDs(5, 3)},
	} {
		got := loadTestFeedItems(t, store, test.feed.ID)
		if !slices.Equal(itemIDs(got), test.want) || !got[0].Read || got[1].Read {
			t.Fatalf("items after pruning %q = %+v, want %v with only newest read", test.feed.Title, got, test.want)
		}
	}
}

func TestSettingRepoEqualOrHigherRetentionDoesNotPrune(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	feed := createFeed(t, store, "Feed", nil)
	if err := store.Settings().UpdateRetention(ctx, 1); err != nil {
		t.Fatalf("set initial retention: %v", err)
	}

	// An upgraded database can still contain rows above its configured retention.
	items := addItems(t, store, feed, 3)
	for _, retention := range []int{1, 2} {
		if err := store.Settings().UpdateRetention(ctx, retention); err != nil {
			t.Fatalf("set retention to %d: %v", retention, err)
		}

		if got, want := itemIDs(loadTestFeedItems(t, store, feed.ID)), []string{items[2].ID, items[1].ID, items[0].ID}; !slices.Equal(got, want) {
			t.Fatalf("items after setting retention to %d = %v, want %v", retention, got, want)
		}
	}
}

func TestSettingRepoBrowserlessRoundTrip(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	requireBrowserless(t, repo, nil)

	full := domain.BrowserlessSettings{URL: "https://browserless.example.com", Token: ptr("token-1"), ResidentialProxy: true}
	if err := repo.UpdateBrowserless(ctx, full); err != nil {
		t.Fatalf("update browserless: %v", err)
	}

	requireBrowserless(t, repo, &full)

	if got := countRows(t, store, `SELECT COUNT(*) FROM setting WHERE browserless_residential_proxy = 1`); got != 1 {
		t.Fatalf("rows with residential proxy stored as 1 = %d, want 1", got)
	}

	changed := domain.BrowserlessSettings{URL: "http://browserless.internal:3000/base"}
	if err := repo.UpdateBrowserless(ctx, changed); err != nil {
		t.Fatalf("update browserless without token: %v", err)
	}

	requireBrowserless(t, repo, &domain.BrowserlessSettings{URL: changed.URL, Token: ptr("token-1")})
}

func TestSettingRepoBrowserlessWithoutTokenStoresNoToken(t *testing.T) {
	store := newTestStore(t)
	repo := store.Settings()

	service := domain.BrowserlessSettings{URL: "https://browserless.example.com"}
	if err := repo.UpdateBrowserless(context.Background(), service); err != nil {
		t.Fatalf("update browserless: %v", err)
	}

	requireBrowserless(t, repo, &service)
}

func TestSettingRepoBrowserlessBlankTokenKeepsStoredToken(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	service := domain.BrowserlessSettings{URL: "https://browserless.example.com", Token: ptr("token-1")}
	if err := repo.UpdateBrowserless(ctx, service); err != nil {
		t.Fatalf("update browserless: %v", err)
	}

	for name, token := range map[string]*string{"nil": nil, "blank": ptr("   "), "empty": ptr("")} {
		t.Run(name, func(t *testing.T) {
			update := domain.BrowserlessSettings{URL: service.URL, Token: token}
			if err := repo.UpdateBrowserless(ctx, update); err != nil {
				t.Fatalf("update browserless: %v", err)
			}

			requireBrowserless(t, repo, &service)
		})
	}

	rotated := domain.BrowserlessSettings{URL: service.URL, Token: ptr("token-2")}
	if err := repo.UpdateBrowserless(ctx, rotated); err != nil {
		t.Fatalf("update browserless with rotated token: %v", err)
	}

	requireBrowserless(t, repo, &rotated)
}

func TestSettingRepoDeleteBrowserlessToken(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	service := domain.BrowserlessSettings{URL: "https://browserless.example.com", Token: ptr("token-1"), ResidentialProxy: true}
	if err := repo.UpdateBrowserless(ctx, service); err != nil {
		t.Fatalf("update browserless: %v", err)
	}

	if err := repo.DeleteBrowserlessToken(ctx); err != nil {
		t.Fatalf("delete browserless token: %v", err)
	}

	requireBrowserless(t, repo, &domain.BrowserlessSettings{URL: service.URL, ResidentialProxy: true})
}

func TestSettingRepoDeleteBrowserlessClearsEverythingElseStays(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

	if err := repo.UpdateRetention(ctx, 250); err != nil {
		t.Fatalf("update retention: %v", err)
	}

	smtp := domain.SMTPSettings{SenderEmail: "sender@example.com", Host: "smtp.example.com", Port: 587, Security: domain.SMTPSecuritySTARTTLS}
	if err := repo.UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("update smtp: %v", err)
	}

	service := domain.BrowserlessSettings{URL: "https://browserless.example.com", Token: ptr("token-1"), ResidentialProxy: true}
	if err := repo.UpdateBrowserless(ctx, service); err != nil {
		t.Fatalf("update browserless: %v", err)
	}

	if err := repo.DeleteBrowserless(ctx); err != nil {
		t.Fatalf("delete browserless: %v", err)
	}

	requireBrowserless(t, repo, nil)

	cleared := `SELECT COUNT(*) FROM setting WHERE browserless_url IS NULL AND browserless_token IS NULL AND browserless_residential_proxy = 0`
	if got := countRows(t, store, cleared); got != 1 {
		t.Fatalf("setting rows with cleared browserless columns = %d, want 1", got)
	}

	settings, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}

	if settings.Retention != 250 || settings.SMTP == nil {
		t.Fatalf("settings after deleting browserless = %+v, want retention 250 and smtp kept", settings)
	}

	if err := repo.UpdateBrowserless(ctx, domain.BrowserlessSettings{URL: service.URL}); err != nil {
		t.Fatalf("update browserless after delete: %v", err)
	}

	requireBrowserless(t, repo, &domain.BrowserlessSettings{URL: service.URL})
}

func TestSettingRepoServices(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	repo := store.Settings()

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

	settings, err := repo.Get(ctx)
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
		Language:    domain.KindleLanguageChinese,
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
		Language:    domain.KindleLanguageChinese,
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

	requireNextSendAt(t, store, nil)

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

	// 08:30 Shanghai on 2024-06-01 is 00:30 UTC, already past at 08:00 UTC.
	requireNextSendAt(t, store, ptrTime(time.Date(2024, 6, 2, 0, 30, 0, 0, time.UTC)))

	manualOnly := domain.KindleSettings{Language: domain.KindleLanguageChinese, KindleEmail: "reader@kindle.com"}
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
	requireNextSendAt(t, store, nil)

	scheduleColumnsSet := `SELECT COUNT(*) FROM setting WHERE send_hour IS NOT NULL OR send_minute IS NOT NULL OR timezone IS NOT NULL`
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

func TestSettingRepoKindleNextSendAt(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	configureManualKindleForTest(t, store)

	base := time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC)
	at := func(hours int) time.Time { return base.Add(time.Duration(hours) * time.Hour) }
	utc := func(day, hour, minute int) *time.Time {
		return ptrTime(time.Date(2024, 6, day, hour, minute, 0, 0, time.UTC))
	}

	// Each step builds on the previous one: the rule depends on the stored state.
	steps := []struct {
		name     string
		now      time.Time
		email    string
		schedule *domain.KindleSchedule
		want     *time.Time
	}{
		{"enable schedule", at(0), "reader@kindle.com", &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"}, utc(1, 8, 30)},
		{"unchanged schedule keeps an overdue next send", at(1), "reader@kindle.com", &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "UTC"}, utc(1, 8, 30)},
		{"hour change recomputes", at(2), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "UTC"}, utc(2, 9, 30)},
		{"minute change recomputes", at(3), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "UTC"}, utc(2, 9, 35)},
		{"timezone change recomputes", at(4), "reader@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, utc(2, 0, 35)},
		{"email change keeps the next send", at(5), "other@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, utc(2, 0, 35)},
		{"disable deletes the row", at(6), "other@kindle.com", nil, nil},
		{"re-enable the same schedule recomputes", at(48), "other@kindle.com", &domain.KindleSchedule{Hour: 9, Minute: 35, Timezone: "Asia/Tokyo"}, utc(4, 0, 35)},
	}

	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			kindle := domain.KindleSettings{
				Language:    domain.KindleLanguageChinese,
				KindleEmail: step.email,
				Schedule:    step.schedule,
				// Caller-supplied values are ignored: next_send_at is runtime state.
				NextSendAt: ptrTime(time.Unix(1, 0)),
			}
			if err := store.Settings().UpdateKindle(ctx, kindle, step.now); err != nil {
				t.Fatalf("update kindle: %v", err)
			}

			settings, err := store.Settings().Get(ctx)
			if err != nil || settings.Kindle == nil {
				t.Fatalf("get settings: (%+v, %v)", settings, err)
			}

			assertKindleSettings(t, *settings.Kindle, kindle)
			requireNextSendAt(t, store, step.want)
		})
	}
}

func TestSettingRepoKindleNextSendAtSkipsSpringForwardGap(t *testing.T) {
	store := newTestStore(t)
	configureManualKindleForTest(t, store)

	// 02:30 does not exist in America/New_York on 2024-03-10, when 02:00 jumps to 03:00.
	kindle := domain.KindleSettings{
		Language:    domain.KindleLanguageChinese,
		KindleEmail: "reader@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 2, Minute: 30, Timezone: "America/New_York"},
	}
	now := time.Date(2024, 3, 9, 12, 0, 0, 0, time.UTC)
	if err := store.Settings().UpdateKindle(context.Background(), kindle, now); err != nil {
		t.Fatalf("update kindle: %v", err)
	}

	// The next send is 02:30 EDT on 2024-03-11 (UTC-4), not a shifted time on the gap day.
	requireNextSendAt(t, store, ptrTime(time.Date(2024, 3, 11, 6, 30, 0, 0, time.UTC)))
}

func TestSettingRepoKindleRejectsOutOfRangeScheduleWithoutHoldingTheWriter(t *testing.T) {
	store := newTestStore(t)
	configureManualKindleForTest(t, store)

	now := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	for _, schedule := range []domain.KindleSchedule{
		{Hour: 24, Minute: 0, Timezone: "UTC"},
		{Hour: 8, Minute: 60, Timezone: "UTC"},
	} {
		kindle := domain.KindleSettings{Language: domain.KindleLanguageChinese, KindleEmail: "reader@kindle.com", Schedule: &schedule}
		requireCode(t, store.Settings().UpdateKindle(context.Background(), kindle, now), domain.ErrInvalidKindleSetting)
	}

	requireNextSendAt(t, store, nil)

	if err := store.Settings().UpdateRetention(context.Background(), 50); err != nil {
		t.Fatalf("write after rejected schedule: %v", err)
	}
}
