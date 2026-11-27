package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"reader/internal/domain"
	"reflect"
	"strings"
	"testing"
	"time"
)

const browserlessTestURL = "https://browserless.example.com"

type recordingSettingRepo struct {
	domain.SettingRepository
	browserless []domain.BrowserlessSettings
}

func (r *recordingSettingRepo) UpdateBrowserless(ctx context.Context, browserless domain.BrowserlessSettings) error {
	r.browserless = append(r.browserless, browserless)

	return r.SettingRepository.UpdateBrowserless(ctx, browserless)
}

func TestSettingsRedaction(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	ctx := context.Background()
	browserlessToken := "browserless-super-secret"
	smtpPassword := "smtp-super-secret"
	smtpUser := "smtp-user"

	for _, err := range []error{
		h.db.Settings().UpdateRetention(ctx, 42),
		h.db.Settings().UpdateBrowserless(ctx, domain.BrowserlessSettings{
			URL:              browserlessTestURL,
			Token:            &browserlessToken,
			ResidentialProxy: true,
		}),
		h.db.Settings().UpdateSMTP(ctx, domain.SMTPSettings{
			SenderEmail: "reader@example.com",
			Host:        "smtp.example.com",
			Port:        465,
			Security:    domain.SMTPSecurityTLS,
			User:        &smtpUser,
			Password:    &smtpPassword,
		}),
		h.db.Settings().UpdateKindle(ctx, domain.KindleSettings{
			Language:    domain.KindleLanguageChinese,
			KindleEmail: "reader@kindle.com",
			Schedule:    &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "Asia/Shanghai"},
		}, h.clock.Now()),
	} {
		if err != nil {
			t.Fatalf("seed settings: %v", err)
		}
	}

	recorder := h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)
	requireJSONContentType(t, recorder)

	body := recorder.Body.String()
	for _, secret := range []string{browserlessToken, smtpPassword} {
		if strings.Contains(body, secret) {
			t.Fatalf("settings response leaked %q: %s", secret, body)
		}
	}

	var payload struct {
		Retention   int `json:"retention"`
		Browserless struct {
			URL              string `json:"url"`
			TokenConfigured  bool   `json:"tokenConfigured"`
			ResidentialProxy bool   `json:"residentialProxy"`
		} `json:"browserless"`
		SMTP struct {
			SenderEmail        string `json:"senderEmail"`
			Host               string `json:"host"`
			Port               int    `json:"port"`
			Security           string `json:"security"`
			User               string `json:"user"`
			PasswordConfigured bool   `json:"passwordConfigured"`
		} `json:"smtp"`
		Kindle struct {
			KindleEmail string `json:"kindleEmail"`
			Language    string `json:"language"`
			Schedule    struct {
				Hour     int    `json:"hour"`
				Minute   int    `json:"minute"`
				Timezone string `json:"timezone"`
			} `json:"schedule"`
			NextSendAt string `json:"nextSendAt"`
		} `json:"kindle"`
	}
	decodeBody(t, recorder, &payload)

	if payload.Retention != 42 {
		t.Fatalf("settings = %+v", payload)
	}

	if payload.Browserless.URL != browserlessTestURL || !payload.Browserless.TokenConfigured || !payload.Browserless.ResidentialProxy {
		t.Fatalf("browserless = %+v", payload.Browserless)
	}

	if payload.SMTP.SenderEmail != "reader@example.com" || payload.SMTP.Host != "smtp.example.com" || payload.SMTP.Port != 465 || payload.SMTP.Security != "tls" {
		t.Fatalf("smtp = %+v", payload.SMTP)
	}

	if payload.SMTP.User != "smtp-user" || !payload.SMTP.PasswordConfigured {
		t.Fatalf("smtp auth = %+v", payload.SMTP)
	}

	// The schedule was saved at the harness clock (08:00 UTC), after that day's
	// 08:30 Asia/Shanghai occurrence (00:30 UTC), so the stored next send is the following day's.
	if payload.Kindle.KindleEmail != "reader@kindle.com" || payload.Kindle.Language != "zh" || payload.Kindle.Schedule.Timezone != "Asia/Shanghai" || payload.Kindle.Schedule.Hour != 8 || payload.Kindle.Schedule.Minute != 30 || payload.Kindle.NextSendAt != "2026-03-02T00:30:00Z" {
		t.Fatalf("kindle = %+v", payload.Kindle)
	}

	for _, err := range []error{
		h.db.Settings().DeleteSMTP(ctx),
		h.db.Settings().UpdateSMTP(ctx, domain.SMTPSettings{
			SenderEmail: "reader@example.com",
			Host:        "smtp.example.com",
			Port:        587,
			Security:    domain.SMTPSecuritySTARTTLS,
		}),
		h.db.Settings().UpdateKindle(ctx, domain.KindleSettings{Language: domain.KindleLanguageChinese, KindleEmail: "reader@kindle.com"}, h.clock.Now()),
		h.db.Settings().DeleteBrowserlessToken(ctx),
		h.db.Settings().UpdateBrowserless(ctx, domain.BrowserlessSettings{URL: browserlessTestURL}),
	} {
		if err != nil {
			t.Fatalf("update partial settings: %v", err)
		}
	}

	recorder = h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	var partial map[string]any
	decodeBody(t, recorder, &partial)
	browserlessObj := partial["browserless"].(map[string]any)
	if browserlessObj["url"] != browserlessTestURL || browserlessObj["tokenConfigured"] != false || browserlessObj["residentialProxy"] != false {
		t.Fatalf("browserless without token = %v", browserlessObj)
	}

	smtpObj := partial["smtp"].(map[string]any)
	if _, hasUser := smtpObj["user"]; hasUser {
		t.Fatalf("smtp.user must be omitted when nil: %s", recorder.Body.String())
	}

	if smtpObj["passwordConfigured"] != false {
		t.Fatalf("passwordConfigured = %v", smtpObj["passwordConfigured"])
	}

	kindleObj := partial["kindle"].(map[string]any)
	if _, hasTimezone := kindleObj["timezone"]; hasTimezone {
		t.Fatalf("kindle.timezone must not be a top-level field: %s", recorder.Body.String())
	}

	if _, hasSchedule := kindleObj["schedule"]; hasSchedule {
		t.Fatalf("kindle.schedule must be omitted when scheduled sending is off: %s", recorder.Body.String())
	}

	if _, hasNextSendAt := kindleObj["nextSendAt"]; hasNextSendAt {
		t.Fatalf("kindle.nextSendAt must be omitted when scheduled sending is off: %s", recorder.Body.String())
	}

	for _, err := range []error{
		h.db.Settings().DeleteSMTP(ctx),
		h.db.Settings().DeleteBrowserless(ctx),
	} {
		if err != nil {
			t.Fatalf("clear settings: %v", err)
		}
	}
	for _, statement := range []string{
		`DELETE FROM kindle_schedule WHERE setting_id = 1`,
		`UPDATE setting SET kindle_email = NULL, send_hour = NULL, send_minute = NULL WHERE id = 1`,
	} {
		if _, err := h.db.WriteDB().ExecContext(ctx, statement); err != nil {
			t.Fatalf("clear kindle settings: %v", err)
		}
	}

	recorder = h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	var generic map[string]any
	decodeBody(t, recorder, &generic)
	if _, present := generic["smtp"]; present {
		t.Fatalf("smtp must be omitted when unconfigured: %s", recorder.Body.String())
	}

	if _, present := generic["kindle"]; present {
		t.Fatalf("kindle must be omitted when unconfigured: %s", recorder.Body.String())
	}

	if _, present := generic["browserless"]; present {
		t.Fatalf("browserless must be omitted when unconfigured: %s", recorder.Body.String())
	}

	for _, removed := range []string{"provider", "jinaKeyConfigured", "browserEndpointConfigured"} {
		if _, present := generic[removed]; present {
			t.Fatalf("%s was removed from the settings response: %s", removed, recorder.Body.String())
		}
	}
}

func TestSettingsUpdates(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 0}), http.StatusBadRequest, "InvalidRetention")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 25}), http.StatusNoContent)
	if got := h.loadSettings().Retention; got != 25 {
		t.Fatalf("retention = %d", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 0}), http.StatusBadRequest, "InvalidRetention")
}

func TestRetentionUpdateLimits(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.seedFeed("First", "https://first.example.com/rss", nil)
	h.seedFeed("Second", "https://second.example.com/rss", nil)

	const target = "/api/settings/retention"
	requireStatus(t, h.authed(http.MethodPut, target, map[string]any{"retention": 5000}), http.StatusNoContent)
	requireAPIError(t, h.authed(http.MethodPut, target, map[string]any{"retention": 5001}), http.StatusBadRequest, "FeedItemBudgetExceeded")
	requireAPIError(t, h.authed(http.MethodPut, target, map[string]any{"retention": 10001}), http.StatusBadRequest, "InvalidRetention")

	if got := h.loadSettings().Retention; got != 5000 {
		t.Fatalf("retention after rejected updates = %d, want 5000", got)
	}
}

func TestBrowserlessSettingsUpdate(t *testing.T) {
	t.Parallel()

	var repo *recordingSettingRepo
	h := newHarnessWith(t, func(cfg *Config) {
		repo = &recordingSettingRepo{SettingRepository: cfg.Settings}
		cfg.Settings = repo
	})
	target := "/api/settings/services/browserless"
	secret := "browserless-secret"

	requireStatus(t, h.authed(http.MethodPut, target, map[string]any{
		"url":              "  " + browserlessTestURL + "/  ",
		"token":            secret,
		"residentialProxy": true,
	}), http.StatusNoContent)

	saved := domain.BrowserlessSettings{URL: browserlessTestURL, Token: &secret, ResidentialProxy: true}
	requireBrowserlessSaves(t, repo.browserless, saved)
	requireStoredBrowserless(t, h, saved)

	requireStatus(t, h.authed(http.MethodPut, target, map[string]any{"url": browserlessTestURL, "token": "   "}), http.StatusNoContent)
	requireStatus(t, h.authed(http.MethodPut, target, map[string]any{"url": browserlessTestURL}), http.StatusNoContent)

	withoutToken := domain.BrowserlessSettings{URL: browserlessTestURL}
	requireBrowserlessSaves(t, repo.browserless, saved, withoutToken, withoutToken)
	requireStoredBrowserless(t, h, domain.BrowserlessSettings{URL: browserlessTestURL, Token: &secret})

	for name, body := range map[string]map[string]any{
		"missing url":    {"token": secret},
		"blank url":      {"url": "   "},
		"unknown scheme": {"url": "ftp://browserless.example.com"},
		"credentials":    {"url": "https://user:pass@browserless.example.com"},
		"query":          {"url": browserlessTestURL + "?token=abc"},
	} {
		t.Run(name, func(t *testing.T) {
			requireAPIError(t, h.authed(http.MethodPut, target, body), http.StatusBadRequest, "InvalidBrowserlessSetting")
		})
	}

	requireBrowserlessSaves(t, repo.browserless, saved, withoutToken, withoutToken)
}

func TestBrowserlessSettingsDelete(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	secret := "browserless-secret"
	seeded := domain.BrowserlessSettings{URL: browserlessTestURL, Token: &secret, ResidentialProxy: true}

	if err := h.db.Settings().UpdateBrowserless(context.Background(), seeded); err != nil {
		t.Fatalf("seed browserless: %v", err)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/browserless/token", nil), http.StatusNoContent)
	requireStoredBrowserless(t, h, domain.BrowserlessSettings{URL: browserlessTestURL, ResidentialProxy: true})

	if err := h.db.Settings().UpdateBrowserless(context.Background(), seeded); err != nil {
		t.Fatalf("reseed browserless: %v", err)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/browserless", nil), http.StatusNoContent)
	if stored := h.loadSettings().Browserless; stored != nil {
		t.Fatalf("browserless settings were not deleted: %+v", stored)
	}
}

func requireBrowserlessSaves(t *testing.T, got []domain.BrowserlessSettings, want ...domain.BrowserlessSettings) {
	t.Helper()

	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		t.Fatalf("browserless saves = %s, want %s", gotJSON, wantJSON)
	}
}

func requireStoredBrowserless(t *testing.T, h *harness, want domain.BrowserlessSettings) {
	t.Helper()

	stored := h.loadSettings().Browserless
	if stored == nil {
		t.Fatalf("browserless settings were not stored, want %+v", want)
	}

	requireBrowserlessSaves(t, []domain.BrowserlessSettings{*stored}, want)
}

func TestSMTPSettingsUpdate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	body := map[string]any{
		"senderEmail": "reader@example.com",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
		"user":        "  smtp-user  ",
		"password":    "smtp-secret",
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", body), http.StatusNoContent)

	stored := h.loadSettings().SMTP
	if stored == nil || stored.SenderEmail != "reader@example.com" || stored.Port != 465 || stored.Security != domain.SMTPSecurityTLS {
		t.Fatalf("stored smtp = %+v", stored)
	}

	if stored.User == nil || *stored.User != "smtp-user" {
		t.Fatalf("stored smtp user = %v", stored.User)
	}

	if stored.Password == nil || *stored.Password != "smtp-secret" {
		t.Fatal("smtp password was not stored")
	}

	body["password"] = "   "
	body["user"] = "   "
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", body), http.StatusNoContent)

	stored = h.loadSettings().SMTP
	if stored.Password == nil || *stored.Password != "smtp-secret" {
		t.Fatal("blank smtp password must preserve the stored secret")
	}

	if stored.User != nil {
		t.Fatalf("blank user must clear user, got %q", *stored.User)
	}

	invalid := map[string]any{
		"senderEmail": "not-an-email",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
	}
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["senderEmail"] = "reader@example.com"
	invalid["host"] = "   "
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["host"] = "smtp.example.com"
	invalid["port"] = 0
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["port"] = 465
	invalid["security"] = "ssl"
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp/password", nil), http.StatusNoContent)
	if smtp := h.loadSettings().SMTP; smtp == nil || smtp.Password != nil {
		t.Fatalf("smtp password was not deleted: %+v", smtp)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp", nil), http.StatusNoContent)
	if smtp := h.loadSettings().SMTP; smtp != nil {
		t.Fatalf("smtp settings were not deleted: %+v", smtp)
	}
}

func TestKindleSettingsUpdate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	body := map[string]any{
		"kindleEmail": "reader@kindle.com",
		"language":    "ja",
		"schedule":    map[string]any{"hour": 9, "minute": 30, "timezone": "Asia/Shanghai"},
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusUnprocessableEntity, "SMTPNotConfigured")

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", map[string]any{
		"senderEmail": "reader@example.com",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
		"password":    "smtp-secret",
	}), http.StatusNoContent)

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored := h.loadSettings().Kindle
	if stored == nil {
		t.Fatal("kindle settings were not stored")
	}

	if stored.KindleEmail != "reader@kindle.com" || stored.Language != domain.KindleLanguageJapanese {
		t.Fatalf("stored kindle = %+v", stored)
	}

	if stored.Schedule == nil || *stored.Schedule != (domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "Asia/Shanghai"}) {
		t.Fatalf("schedule = %v, want 09:30 Asia/Shanghai", stored.Schedule)
	}

	// 09:30 Asia/Shanghai on the harness day (01:30 UTC) is before the request time (08:00 UTC).
	wantNextSendAt := time.Date(2026, time.March, 2, 1, 30, 0, 0, time.UTC)
	if stored.NextSendAt == nil || !stored.NextSendAt.Equal(wantNextSendAt) {
		t.Fatalf("next send at = %v, want %v", stored.NextSendAt, wantNextSendAt)
	}

	delete(body, "schedule")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored = h.loadSettings().Kindle
	if stored.Schedule != nil || stored.NextSendAt != nil {
		t.Fatalf("disabled schedule = %+v, want no schedule", stored)
	}

	for name, invalid := range map[string]map[string]any{
		"email":            {"kindleEmail": "not-an-email", "language": "zh"},
		"missing language": {"kindleEmail": "reader@kindle.com"},
		"language":         {"kindleEmail": "reader@kindle.com", "language": "fr"},
		"timezone":         {"kindleEmail": "reader@kindle.com", "language": "zh", "schedule": map[string]any{"hour": 9, "minute": 30, "timezone": "Mars/Olympus_Mons"}},
		"missing timezone": {"kindleEmail": "reader@kindle.com", "language": "zh", "schedule": map[string]any{"hour": 9, "minute": 30}},
		"schedule":         {"kindleEmail": "reader@kindle.com", "language": "zh", "schedule": map[string]any{"hour": 9, "minute": 7, "timezone": "UTC"}},
	} {
		t.Run(name, func(t *testing.T) {
			requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", invalid), http.StatusBadRequest, "InvalidKindleSetting")
		})
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp", nil), http.StatusNoContent)
	if kindle := h.loadSettings().Kindle; kindle == nil || kindle.KindleEmail != "reader@kindle.com" {
		t.Fatalf("clearing smtp must keep kindle address: %+v", kindle)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusUnprocessableEntity, "SMTPNotConfigured")
}

func TestKindleSettingsUpdateRequiresScheduleHourAndMinute(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	seedKindleSchedule(t, h, h.clock.Now())

	for name, schedule := range map[string]map[string]any{
		"missing hour":   {"minute": 30, "timezone": "UTC"},
		"missing minute": {"hour": 9, "timezone": "UTC"},
		"null hour":      {"hour": nil, "minute": 30, "timezone": "UTC"},
		"null minute":    {"hour": 9, "minute": nil, "timezone": "UTC"},
	} {
		t.Run(name, func(t *testing.T) {
			body := map[string]any{"kindleEmail": "reader@kindle.com", "language": "zh", "schedule": schedule}
			requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusBadRequest, "InvalidKindleSetting")
		})
	}

	if stored := h.loadSettings().Kindle; stored == nil || stored.Schedule == nil || stored.Schedule.Hour != 8 || stored.Schedule.Minute != 30 {
		t.Fatalf("rejected updates must keep the stored schedule: %+v", stored)
	}

	midnight := map[string]any{
		"kindleEmail": "reader@kindle.com",
		"language":    "zh",
		"schedule":    map[string]any{"hour": 0, "minute": 0, "timezone": "UTC"},
	}
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", midnight), http.StatusNoContent)

	stored := h.loadSettings().Kindle
	if stored == nil || stored.Schedule == nil || *stored.Schedule != (domain.KindleSchedule{Hour: 0, Minute: 0, Timezone: "UTC"}) {
		t.Fatalf("explicit 00:00 schedule = %+v, want 00:00 UTC", stored)
	}
}

func seedKindleSchedule(t *testing.T, h *harness, now time.Time) {
	t.Helper()

	ctx := context.Background()
	smtp := domain.SMTPSettings{
		SenderEmail: "reader@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
	}

	if err := h.db.Settings().UpdateSMTP(ctx, smtp); err != nil {
		t.Fatalf("seed smtp: %v", err)
	}

	kindle := domain.KindleSettings{
		Language:    domain.KindleLanguageChinese,
		KindleEmail: "reader@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "Asia/Shanghai"},
	}

	if err := h.db.Settings().UpdateKindle(ctx, kindle, now); err != nil {
		t.Fatalf("seed kindle: %v", err)
	}
}

func TestSettingsKindleNextSendAtReturnsStoredValue(t *testing.T) {
	t.Parallel()

	// The stored time is returned as is, so an overdue send that has not been
	// claimed yet stays visible instead of being recomputed to the next day.
	cases := map[string]time.Duration{
		"upcoming": time.Hour,
		"overdue":  -3 * time.Hour,
	}

	for name, offset := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			h := newHarness(t)
			seedKindleSchedule(t, h, h.clock.Now())

			stored := h.clock.Now().Add(offset)
			if _, err := h.db.WriteDB().ExecContext(
				context.Background(),
				`UPDATE kindle_schedule SET next_send_at = ? WHERE setting_id = 1`,
				stored.UnixMilli(),
			); err != nil {
				t.Fatalf("store next send time: %v", err)
			}

			recorder := h.authed(http.MethodGet, "/api/settings", nil)
			requireStatus(t, recorder, http.StatusOK)

			var payload struct {
				Kindle struct {
					NextSendAt string `json:"nextSendAt"`
				} `json:"kindle"`
			}
			decodeBody(t, recorder, &payload)

			if payload.Kindle.NextSendAt != stored.Format(time.RFC3339) {
				t.Fatalf("nextSendAt = %q, want the stored %q", payload.Kindle.NextSendAt, stored.Format(time.RFC3339))
			}
		})
	}
}

func TestSettingsGetReportsCorruptedStoredScheduleAsInternalError(t *testing.T) {
	t.Parallel()

	for name, corrupt := range map[string]string{
		"hour":              `send_hour = 24`,
		"minute":            `send_minute = 7`,
		"timezone":          `timezone = 'Mars/Olympus_Mons'`,
		"padded timezone":   `timezone = ' Asia/Shanghai'`,
		"minute out of cap": `send_minute = 60`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			h := newHarness(t)
			seedKindleSchedule(t, h, h.clock.Now())

			if _, err := h.db.WriteDB().ExecContext(context.Background(), `UPDATE setting SET `+corrupt+` WHERE id = 1`); err != nil {
				t.Fatalf("corrupt stored schedule: %v", err)
			}

			requireAPIError(t, h.authed(http.MethodGet, "/api/settings", nil), http.StatusInternalServerError, "SettingRepositoryError")
		})
	}
}
