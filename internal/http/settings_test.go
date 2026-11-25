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
	sendTime := "08:00"
	nextSendAt := time.Date(2026, time.March, 1, 8, 30, 0, 0, time.UTC)

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
			SendTime:    &sendTime,
			NextSendAt:  &nextSendAt,
		}),
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
			SendTime    string `json:"sendTime"`
			NextSendAt  string `json:"nextSendAt"`
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

	if payload.Kindle.KindleEmail != "reader@kindle.com" || payload.Kindle.SendTime != "08:00" || payload.Kindle.NextSendAt != "2026-03-01T08:30:00Z" {
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
		h.db.Settings().UpdateKindle(ctx, domain.KindleSettings{
			KindleEmail: "reader@kindle.com",
		}),
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
	if _, hasSendTime := kindleObj["sendTime"]; hasSendTime {
		t.Fatalf("kindle.sendTime must be omitted when nil: %s", recorder.Body.String())
	}

	if _, hasNextSendAt := kindleObj["nextSendAt"]; hasNextSendAt {
		t.Fatalf("kindle.nextSendAt must be omitted when nil: %s", recorder.Body.String())
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
	if _, err := h.db.WriteDB().ExecContext(ctx, `UPDATE setting SET kindle_email = NULL, send_time = NULL, next_send_at = NULL WHERE id = 1`); err != nil {
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
		"sendTime":    "09:30",
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

	if stored.SendTime == nil || *stored.SendTime != "09:30" {
		t.Fatalf("send time = %v", stored.SendTime)
	}

	if stored.NextSendAt == nil || stored.NextSendAt.Format(time.RFC3339) != "2026-03-01T09:30:00Z" {
		t.Fatalf("next send at = %v", stored.NextSendAt)
	}

	body["sendTime"] = ""
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored = h.loadSettings().Kindle
	if stored.SendTime != nil || stored.NextSendAt != nil {
		t.Fatalf("disabled schedule = %v / %v", stored.SendTime, stored.NextSendAt)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", map[string]any{
		"kindleEmail": "not-an-email",
	}), http.StatusBadRequest, "InvalidKindleSetting")

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", map[string]any{
		"kindleEmail": "reader@kindle.com",
		"sendTime":    "09:15",
	}), http.StatusBadRequest, "InvalidKindleSetting")

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp", nil), http.StatusNoContent)
	if kindle := h.loadSettings().Kindle; kindle == nil || kindle.KindleEmail != "reader@kindle.com" {
		t.Fatalf("clearing smtp must keep kindle address: %+v", kindle)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusUnprocessableEntity, "SMTPNotConfigured")
}
