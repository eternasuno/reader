package httpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHealthz(t *testing.T) {
	t.Parallel()

	healthy := newHarness(t)
	recorder := healthy.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusOK)
	requireJSONContentType(t, recorder)

	var payload statusResponse
	decodeBody(t, recorder, &payload)
	if payload.Status != "ok" {
		t.Fatalf("status payload = %q", payload.Status)
	}

	unhealthy := newHarnessWith(t, func(cfg *Config) {
		cfg.HealthCheck = func(ctx context.Context) error { return errors.New("database is locked") }
	})
	recorder = unhealthy.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusServiceUnavailable)

	if strings.Contains(recorder.Body.String(), "database is locked") {
		t.Fatalf("health failure leaked the internal cause: %s", recorder.Body.String())
	}
}

func TestAPICacheControlNoStore(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	for _, tc := range []struct {
		name string
		req  *http.Request
		want int
	}{
		{name: "public session", want: http.StatusOK, req: h.newRequest(http.MethodGet, "/api/auth/session", nil)},
		{name: "unauthorized", want: http.StatusUnauthorized, req: h.newRequest(http.MethodGet, "/api/folders", nil)},
		{name: "csrf forbidden", want: http.StatusForbidden, req: httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)},
		{name: "api not found", want: http.StatusNotFound, req: func() *http.Request {
			r := h.newRequest(http.MethodGet, "/api/does-not-exist", nil)
			r.AddCookie(h.sessionCookie())
			return r
		}()},
		{name: "opml export", want: http.StatusOK, req: func() *http.Request {
			r := h.newRequest(http.MethodGet, "/api/opml", nil)
			r.AddCookie(h.sessionCookie())
			return r
		}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := h.do(tc.req)
			requireStatus(t, recorder, tc.want)
			if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
		})
	}
}

func TestStaticSPAFallback(t *testing.T) {
	t.Parallel()

	staticFS := fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<!doctype html><html><body>spa-shell</body></html>")},
		"assets/app-123.js":    &fstest.MapFile{Data: []byte("console.log('app')")},
		"favicon.ico":          &fstest.MapFile{Data: []byte("icon-bytes")},
		"manifest.webmanifest": &fstest.MapFile{Data: []byte("{}")},
	}
	h := newHarnessWith(t, func(cfg *Config) { cfg.StaticFS = staticFS })

	recorder := h.raw(http.MethodGet, "/", nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), "spa-shell") {
		t.Fatalf("root body = %s", recorder.Body.String())
	}
	requireSPASecurityHeaders(t, recorder)

	if cache := recorder.Header().Get("Cache-Control"); cache != "no-cache" {
		t.Fatalf("index cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/later/0190f1f4-0000-7000-8000-000000000000", nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), "spa-shell") {
		t.Fatalf("spa fallback body = %s", recorder.Body.String())
	}
	requireSPASecurityHeaders(t, recorder)

	recorder = h.raw(http.MethodHead, "/settings", nil)
	requireStatus(t, recorder, http.StatusOK)
	requireSPASecurityHeaders(t, recorder)

	recorder = h.raw(http.MethodGet, "/index.html", nil)
	requireSPASecurityHeaders(t, recorder)

	recorder = h.raw(http.MethodGet, "/assets/app-123.js", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "console.log('app')" {
		t.Fatalf("asset body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/favicon.ico", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "icon-bytes" {
		t.Fatalf("favicon body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != "no-cache" {
		t.Fatalf("favicon cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/manifest.webmanifest", nil)
	requireStatus(t, recorder, http.StatusOK)
	if got := recorder.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Fatalf("manifest content type = %q", got)
	}

	requireStatus(t, h.raw(http.MethodGet, "/missing.js", nil), http.StatusNotFound)
	requireStatus(t, h.raw(http.MethodPost, "/later", nil), http.StatusMethodNotAllowed)

	recorder = h.authed(http.MethodGet, "/api/does-not-exist", nil)
	requireAPIError(t, recorder, http.StatusNotFound, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api", nil)
	requireAPIError(t, recorder, http.StatusNotFound, "RequestFailed")

	recorder = h.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusOK)

	for _, route := range []struct{ method, target string }{
		{http.MethodPut, "/api/settings/fetcher/direct"},
		{http.MethodPut, "/api/settings/fetcher/jina"},
		{http.MethodPut, "/api/settings/fetcher/browser"},
		{http.MethodDelete, "/api/settings/fetcher/jina/key"},
		{http.MethodDelete, "/api/settings/kindle/password"},
	} {
		t.Run(route.method+" "+route.target, func(t *testing.T) {
			recorder := h.authed(route.method, route.target, nil)
			if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("%s %s status = %d, want 404 or 405: %s", route.method, route.target, recorder.Code, recorder.Body.String())
			}
		})
	}

}
