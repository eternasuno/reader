package httpserver

import (
	"context"
	"net/http"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestSettingsRedaction(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	ctx := context.Background()
	jinaKey := "jina-super-secret"
	browserEndpoint := "http://browser.internal:9222"
	smtpPassword := "smtp-super-secret"
	smtpUser := "smtp-user"

	for _, err := range []error{
		h.db.Settings().UpdateRetention(ctx, 42),
		h.db.Settings().UpdateJinaKey(ctx, jinaKey),
		h.db.Settings().UpdateBrowserEndpoint(ctx, browserEndpoint),
		h.db.Settings().UpdateProvider(ctx, domain.ProviderBrowser),
		h.db.Settings().UpdateSMTP(ctx, domain.SMTPSettings{
			SenderEmail: "reader@example.com",
			Host:        "smtp.example.com",
			Port:        465,
			Security:    domain.SMTPSecurityTLS,
			User:        &smtpUser,
			Password:    &smtpPassword,
		}),
		h.db.Settings().UpdateKindle(ctx, domain.KindleSettings{
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
	for _, secret := range []string{jinaKey, browserEndpoint, smtpPassword} {
		if strings.Contains(body, secret) {
			t.Fatalf("settings response leaked %q: %s", secret, body)
		}
	}

	var payload struct {
		Retention                 int    `json:"retention"`
		Provider                  string `json:"provider"`
		JinaKeyConfigured         bool   `json:"jinaKeyConfigured"`
		BrowserEndpointConfigured bool   `json:"browserEndpointConfigured"`
		SMTP                      struct {
			SenderEmail        string `json:"senderEmail"`
			Host               string `json:"host"`
			Port               int    `json:"port"`
			Security           string `json:"security"`
			User               string `json:"user"`
			PasswordConfigured bool   `json:"passwordConfigured"`
		} `json:"smtp"`
		Kindle struct {
			KindleEmail string `json:"kindleEmail"`
			Schedule    struct {
				Hour     int    `json:"hour"`
				Minute   int    `json:"minute"`
				Timezone string `json:"timezone"`
			} `json:"schedule"`
			NextSendAt string `json:"nextSendAt"`
		} `json:"kindle"`
	}
	decodeBody(t, recorder, &payload)

	if payload.Retention != 42 || payload.Provider != "browser" {
		t.Fatalf("settings = %+v", payload)
	}

	if !payload.JinaKeyConfigured || !payload.BrowserEndpointConfigured {
		t.Fatalf("secret flags = %+v", payload)
	}

	if payload.SMTP.SenderEmail != "reader@example.com" || payload.SMTP.Host != "smtp.example.com" || payload.SMTP.Port != 465 || payload.SMTP.Security != "tls" {
		t.Fatalf("smtp = %+v", payload.SMTP)
	}

	if payload.SMTP.User != "smtp-user" || !payload.SMTP.PasswordConfigured {
		t.Fatalf("smtp auth = %+v", payload.SMTP)
	}

	// The schedule changed at the harness clock (08:00 UTC), after that day's
	// 08:30 Asia/Shanghai occurrence (00:30 UTC), so the next send is the following day's.
	if payload.Kindle.KindleEmail != "reader@kindle.com" || payload.Kindle.Schedule.Timezone != "Asia/Shanghai" || payload.Kindle.Schedule.Hour != 8 || payload.Kindle.Schedule.Minute != 30 || payload.Kindle.NextSendAt != "2026-03-02T00:30:00Z" {
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
		h.db.Settings().UpdateKindle(ctx, domain.KindleSettings{KindleEmail: "reader@kindle.com"}, h.clock.Now()),
	} {
		if err != nil {
			t.Fatalf("update partial settings: %v", err)
		}
	}

	recorder = h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	var partial map[string]any
	decodeBody(t, recorder, &partial)
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
		h.db.Settings().DeleteJinaKey(ctx),
		h.db.Settings().DeleteBrowserEndpoint(ctx),
	} {
		if err != nil {
			t.Fatalf("clear settings: %v", err)
		}
	}
	if _, err := h.db.WriteDB().ExecContext(ctx, `UPDATE setting SET kindle_email = NULL, send_hour = NULL, send_minute = NULL, schedule_updated_at = NULL WHERE id = 1`); err != nil {
		t.Fatalf("clear kindle settings: %v", err)
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

	if generic["jinaKeyConfigured"] != false || generic["browserEndpointConfigured"] != false {
		t.Fatalf("unconfigured secret flags = %+v", generic)
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
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "browser"}), http.StatusUnprocessableEntity, "BrowserEndpointRequired")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "rss"}), http.StatusBadRequest, "InvalidProvider")

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"}), http.StatusNoContent)
	if got := h.loadSettings().Provider; got != domain.ProviderJina {
		t.Fatalf("provider = %q", got)
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "direct"}), http.StatusNoContent)
	if got := h.loadSettings().Provider; got != domain.ProviderDirect {
		t.Fatalf("provider = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/jina", map[string]any{"key": "   "}), http.StatusBadRequest, "InvalidJinaKey")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/jina", map[string]any{"key": "  jina-key  "}), http.StatusNoContent)
	if s := h.loadSettings(); s.Provider != domain.ProviderDirect || s.JinaKey == nil || *s.JinaKey != "jina-key" {
		t.Fatalf("jina settings = %+v", s)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/jina", nil), http.StatusNoContent)
	if got := h.loadSettings().JinaKey; got != nil {
		t.Fatalf("jina key was not deleted: %q", *got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "   "}), http.StatusBadRequest, "InvalidEndpoint")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "ftp://browser:9222"}), http.StatusBadRequest, "InvalidEndpoint")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": " http://browser:9222 "}), http.StatusNoContent)
	if s := h.loadSettings(); s.Provider != domain.ProviderDirect || s.BrowserEndpoint == nil || *s.BrowserEndpoint != "http://browser:9222" {
		t.Fatalf("browser settings = %+v", s)
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "browser"}), http.StatusNoContent)
	if got := h.loadSettings().Provider; got != domain.ProviderBrowser {
		t.Fatalf("provider = %q", got)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/browser", nil), http.StatusNoContent)
	if s := h.loadSettings(); s.BrowserEndpoint != nil || s.Provider != domain.ProviderDirect {
		t.Fatalf("browser delete did not reset provider: %+v", s)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "unknown"}), http.StatusBadRequest, "InvalidProvider")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": ""}), http.StatusBadRequest, "InvalidProvider")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "   "}), http.StatusBadRequest, "InvalidEndpoint")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "http://"}), http.StatusBadRequest, "InvalidEndpoint")
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

	if stored.KindleEmail != "reader@kindle.com" {
		t.Fatalf("stored kindle = %+v", stored)
	}

	if stored.Schedule == nil || *stored.Schedule != (domain.KindleSchedule{Hour: 9, Minute: 30, Timezone: "Asia/Shanghai"}) {
		t.Fatalf("schedule = %v, want 09:30 Asia/Shanghai", stored.Schedule)
	}

	if stored.ScheduleUpdatedAt == nil || !stored.ScheduleUpdatedAt.Equal(h.clock.Now()) {
		t.Fatalf("schedule updated at = %v, want the request time %v", stored.ScheduleUpdatedAt, h.clock.Now())
	}

	delete(body, "schedule")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored = h.loadSettings().Kindle
	if stored.Schedule != nil || stored.ScheduleUpdatedAt != nil {
		t.Fatalf("disabled schedule = %+v, want no schedule", stored)
	}

	for name, invalid := range map[string]map[string]any{
		"email":            {"kindleEmail": "not-an-email"},
		"timezone":         {"kindleEmail": "reader@kindle.com", "schedule": map[string]any{"hour": 9, "minute": 30, "timezone": "Mars/Olympus_Mons"}},
		"missing timezone": {"kindleEmail": "reader@kindle.com", "schedule": map[string]any{"hour": 9, "minute": 30}},
		"schedule":         {"kindleEmail": "reader@kindle.com", "schedule": map[string]any{"hour": 9, "minute": 7, "timezone": "UTC"}},
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
			body := map[string]any{"kindleEmail": "reader@kindle.com", "schedule": schedule}
			requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusBadRequest, "InvalidKindleSetting")
		})
	}

	if stored := h.loadSettings().Kindle; stored == nil || stored.Schedule == nil || stored.Schedule.Hour != 8 || stored.Schedule.Minute != 30 {
		t.Fatalf("rejected updates must keep the stored schedule: %+v", stored)
	}

	midnight := map[string]any{
		"kindleEmail": "reader@kindle.com",
		"schedule":    map[string]any{"hour": 0, "minute": 0, "timezone": "UTC"},
	}
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", midnight), http.StatusNoContent)

	stored := h.loadSettings().Kindle
	if stored == nil || stored.Schedule == nil || *stored.Schedule != (domain.KindleSchedule{Hour: 0, Minute: 0, Timezone: "UTC"}) {
		t.Fatalf("explicit 00:00 schedule = %+v, want 00:00 UTC", stored)
	}
}

func seedKindleSchedule(t *testing.T, h *harness, updatedAt time.Time) {
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
		KindleEmail: "reader@kindle.com",
		Schedule:    &domain.KindleSchedule{Hour: 8, Minute: 30, Timezone: "Asia/Shanghai"},
	}

	if err := h.db.Settings().UpdateKindle(ctx, kindle, updatedAt); err != nil {
		t.Fatalf("seed kindle: %v", err)
	}
}

func TestSettingsKindleNextSendAtUsesScheduleAnchor(t *testing.T) {
	t.Parallel()

	// The harness clock is 2026-03-01 08:00 UTC, after that day's 08:30
	// Asia/Shanghai occurrence at 00:30 UTC.
	occurrence := time.Date(2026, time.March, 1, 0, 30, 0, 0, time.UTC)
	nextDay := occurrence.AddDate(0, 0, 1)

	type seededSend struct {
		trigger   string
		startedAt time.Time
	}

	cases := []struct {
		name              string
		scheduleUpdatedAt time.Time
		sends             []seededSend
		want              time.Time
	}{
		{
			name:              "unsent occurrence after the schedule changed is still due",
			scheduleUpdatedAt: occurrence.Add(-time.Hour),
			want:              occurrence,
		},
		{
			name:              "schedule changed after the occurrence waits for the next day",
			scheduleUpdatedAt: occurrence.Add(time.Hour),
			want:              nextDay,
		},
		{
			name:              "scheduled send after the occurrence waits for the next day",
			scheduleUpdatedAt: occurrence.Add(-time.Hour),
			sends:             []seededSend{{trigger: "scheduled", startedAt: occurrence.Add(time.Minute)}},
			want:              nextDay,
		},
		{
			name:              "manual send does not consume the occurrence",
			scheduleUpdatedAt: occurrence.Add(-time.Hour),
			sends:             []seededSend{{trigger: "manual", startedAt: occurrence.Add(time.Minute)}},
			want:              occurrence,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			h := newHarness(t)
			seedKindleSchedule(t, h, tc.scheduleUpdatedAt)

			for _, send := range tc.sends {
				if _, err := h.db.WriteDB().ExecContext(
					context.Background(),
					`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, started_at, finished_at) VALUES (?, ?, 'succeeded', 0, 0, ?, ?)`,
					domain.NewID(),
					send.trigger,
					send.startedAt.UnixMilli(),
					send.startedAt.Add(time.Minute).UnixMilli(),
				); err != nil {
					t.Fatalf("seed kindle send: %v", err)
				}
			}

			recorder := h.authed(http.MethodGet, "/api/settings", nil)
			requireStatus(t, recorder, http.StatusOK)

			var payload struct {
				Kindle struct {
					NextSendAt string `json:"nextSendAt"`
				} `json:"kindle"`
			}
			decodeBody(t, recorder, &payload)

			if payload.Kindle.NextSendAt != tc.want.Format(time.RFC3339) {
				t.Fatalf("nextSendAt = %q, want %q", payload.Kindle.NextSendAt, tc.want.Format(time.RFC3339))
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
