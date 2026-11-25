package httpserver

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNewServerValidatesConfig(t *testing.T) {
	t.Parallel()

	for _, rawAppURL := range []string{testAppURL, "HTTP://EXAMPLE.COM", "HtTpS://reader.example.com:8443"} {
		if _, err := NewServer(Config{
			AppURL:        rawAppURL,
			SessionSecret: []byte(testSessionSecret),
			Now:           time.Now,
			Location:      time.UTC,
		}); err != nil {
			t.Fatalf("expected valid config for %q: %v", rawAppURL, err)
		}
	}

	if _, err := NewServer(Config{AppURL: "://bad", SessionSecret: []byte(testSessionSecret), Now: time.Now, Location: time.UTC}); err == nil {
		t.Fatal("expected error for invalid app url")
	}

	if _, err := NewServer(Config{AppURL: "/relative", SessionSecret: []byte(testSessionSecret), Now: time.Now, Location: time.UTC}); err == nil {
		t.Fatal("expected error for app url without host")
	}

	invalidAppURLs := []string{
		"",
		"   ",
		"ftp://reader.example.com",
		"ws://reader.example.com",
		"javascript://reader.example.com",
		"mailto:user@reader.example.com",
		"https://:443",
		"https://reader.example.com:",
		"https://user:topsecret@reader.example.com",
	}

	for _, rawAppURL := range invalidAppURLs {
		_, err := NewServer(Config{
			AppURL:        rawAppURL,
			SessionSecret: []byte(testSessionSecret),
			Now:           time.Now,
			Location:      time.UTC,
		})
		if err == nil {
			t.Fatalf("NewServer(%q) succeeded, want error", rawAppURL)
		}

		if strings.Contains(err.Error(), "topsecret") {
			t.Fatalf("NewServer(%q) leaked credential in error: %v", rawAppURL, err)
		}
	}
}

func TestLoginSessionLifecycle(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.raw(http.MethodGet, "/api/auth/session", nil)
	requireStatus(t, recorder, http.StatusOK)

	var session sessionResponse
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("fresh client must not be authenticated")
	}

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
	requireAPIError(t, recorder, http.StatusUnauthorized, "InvalidCredentials")

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": ""})
	requireAPIError(t, recorder, http.StatusUnauthorized, "InvalidCredentials")

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	requireStatus(t, recorder, http.StatusNoContent)
	if recorder.Body.Len() != 0 {
		t.Fatalf("login 204 must have an empty body, got %q", recorder.Body.String())
	}

	cookie := findCookie(t, recorder, sessionCookieName)
	if cookie.Value == "" {
		t.Fatal("session cookie value is empty")
	}

	if !cookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}

	if !cookie.Secure {
		t.Fatal("session cookie must be Secure for an https APP_URL")
	}

	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie SameSite = %v", cookie.SameSite)
	}

	if cookie.Path != "/" {
		t.Fatalf("session cookie path = %q", cookie.Path)
	}

	if cookie.MaxAge != 30*24*3600 {
		t.Fatalf("session cookie maxAge = %d", cookie.MaxAge)
	}

	if !strings.Contains(cookie.Value, ".") {
		t.Fatalf("session cookie is not signed: %q", cookie.Value)
	}

	recorder = h.authed(http.MethodGet, "/api/auth/session", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if !session.Authenticated {
		t.Fatal("expected an authenticated session")
	}

	// A tampered expiry must fail the HMAC check.
	tampered := *cookie
	tampered.Value = "9999999999." + strings.SplitN(cookie.Value, ".", 2)[1]
	req := h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(&tampered)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("tampered session cookie must not authenticate")
	}

	// Signatures are verified with hmac.Equal, so a forged signature fails.
	forged := *cookie
	forged.Value = strings.SplitN(cookie.Value, ".", 2)[0] + "." + strings.Repeat("00", 32)
	req = h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(&forged)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("forged session signature must not authenticate")
	}

	// The signed expiry must be enforced against the injected clock.
	h.clock.Advance(31 * 24 * time.Hour)
	req = h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(cookie)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("expired session cookie must not authenticate")
	}
}

func TestLogoutClearsSessionCookie(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	cookie := h.sessionCookie()

	req := h.newRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookie)
	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusNoContent)

	cleared := findCookie(t, recorder, sessionCookieName)
	if cleared.Value != "" || cleared.MaxAge >= 0 {
		t.Fatalf("logout cookie = %q maxAge %d", cleared.Value, cleared.MaxAge)
	}
}

func TestLoginRateLimitPerIP(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	limitedIP := "198.51.100.7:41000"

	for attempt := 0; attempt < loginFailureLimit; attempt++ {
		req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		req.RemoteAddr = limitedIP
		requireAPIError(t, h.do(req), http.StatusUnauthorized, "InvalidCredentials")
	}

	req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	req.RemoteAddr = limitedIP
	requireAPIError(t, h.do(req), http.StatusTooManyRequests, "TooManyRequests")

	otherClient := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	otherClient.RemoteAddr = "198.51.100.8:41000"
	requireStatus(t, h.do(otherClient), http.StatusNoContent)

	h.clock.Advance(loginFailureWindow + time.Second)

	retry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	retry.RemoteAddr = limitedIP
	requireStatus(t, h.do(retry), http.StatusNoContent)
}

func TestLoginLimiterReservesAttemptsAtomically(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })

	const concurrent = 50

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		allowed int
	)

	for range concurrent {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if limiter.reserveAttempt("203.0.113.9") {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	if allowed != loginFailureLimit {
		t.Fatalf("allowed attempts = %d, want %d", allowed, loginFailureLimit)
	}
}

func TestLoginLimiterBoundsTrackedIPs(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	clock := now
	limiter := newLoginLimiter(func() time.Time { return clock })

	for i := range maxTrackedLoginIPs {
		if !limiter.reserveAttempt("192.0.2." + strconv.Itoa(i)) {
			t.Fatalf("attempt %d for a fresh ip was rejected before table filled", i)
		}
	}

	for i := range loginOverflowLimit {
		if !limiter.reserveAttempt("192.0.3." + strconv.Itoa(i)) {
			t.Fatalf("overflow attempt %d within shared budget was rejected", i)
		}
	}

	if limiter.reserveAttempt("192.0.3.999") {
		t.Fatal("expected overflow attempt beyond shared budget to be rejected")
	}

	limiter.mu.Lock()
	tracked := len(limiter.attempts)
	limiter.mu.Unlock()

	if tracked != maxTrackedLoginIPs {
		t.Fatalf("tracked ips = %d, want %d (must not evict live windows)", tracked, maxTrackedLoginIPs)
	}

	// Fill table at t=0, advance half past expiry, and verify expired entries are
	// pruned from the front without evicting unexpired entries.
	clock = now
	expLimiter := newLoginLimiter(func() time.Time { return clock })
	for i := range maxTrackedLoginIPs {
		if i == maxTrackedLoginIPs/2 {
			clock = clock.Add(loginFailureWindow / 2)
		}

		if !expLimiter.reserveAttempt("198.51.100." + strconv.Itoa(i)) {
			t.Fatal("unexpected limit on fresh ip")
		}
	}

	clock = now.Add(loginFailureWindow)
	if !expLimiter.reserveAttempt("203.0.113.200") {
		t.Fatal("expected fresh ip after pruning expired entries")
	}

	expLimiter.mu.Lock()
	afterPrune := len(expLimiter.attempts)
	expLimiter.mu.Unlock()
	if afterPrune != maxTrackedLoginIPs/2+1 {
		t.Fatalf("tracked after pruning expired = %d, want %d", afterPrune, maxTrackedLoginIPs/2+1)
	}
}

func TestLoginLimiterSaturationPreservesBlockedIP(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	blockedAddr := "198.51.100.77:41000"

	for range loginFailureLimit {
		req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		req.RemoteAddr = blockedAddr
		requireAPIError(t, h.do(req), http.StatusUnauthorized, "InvalidCredentials")
	}

	req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	req.RemoteAddr = blockedAddr
	requireAPIError(t, h.do(req), http.StatusTooManyRequests, "TooManyRequests")

	// Saturate all remaining table slots and exhaust the shared overflow budget.
	for i := range maxTrackedLoginIPs + loginOverflowLimit + 5 {
		flood := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		flood.RemoteAddr = "192.0.2." + strconv.Itoa(i) + ":41000"
		h.do(flood)
	}

	// Blocked IP must remain blocked even after table saturation.
	retry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	retry.RemoteAddr = blockedAddr
	requireAPIError(t, h.do(retry), http.StatusTooManyRequests, "TooManyRequests")

	h.clock.Advance(loginFailureWindow + time.Second)

	afterWindow := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	afterWindow.RemoteAddr = blockedAddr
	requireStatus(t, h.do(afterWindow), http.StatusNoContent)
}

func TestLoginLimiterOverflowKeepsBlockingUntilExpiry(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	// Seed one early tracked entry so it expires before the overflow window does.
	earlyTrackedReq := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
	earlyTrackedReq.RemoteAddr = "198.51.100.10:41000"
	requireAPIError(t, h.do(earlyTrackedReq), http.StatusUnauthorized, "InvalidCredentials")

	h.clock.Advance(loginFailureWindow / 2)

	for i := range maxTrackedLoginIPs - 1 {
		fillReq := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		fillReq.RemoteAddr = "192.0.2." + strconv.Itoa(i) + ":41000"
		requireAPIError(t, h.do(fillReq), http.StatusUnauthorized, "InvalidCredentials")
	}

	overflowAddr := "203.0.113.50:41000"
	for range loginOverflowLimit {
		req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		req.RemoteAddr = overflowAddr
		requireAPIError(t, h.do(req), http.StatusUnauthorized, "InvalidCredentials")
	}

	blockedReq := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	blockedReq.RemoteAddr = overflowAddr
	requireAPIError(t, h.do(blockedReq), http.StatusTooManyRequests, "TooManyRequests")

	// Free a tracked slot by expiry while the overflow window is still live.
	h.clock.Advance(loginFailureWindow / 2)

	afterExpiryRetry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	afterExpiryRetry.RemoteAddr = overflowAddr
	requireAPIError(t, h.do(afterExpiryRetry), http.StatusTooManyRequests, "TooManyRequests")

	rotatedAfterExpiry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	rotatedAfterExpiry.RemoteAddr = "203.0.113.51:41000"
	requireAPIError(t, h.do(rotatedAfterExpiry), http.StatusTooManyRequests, "TooManyRequests")

	// Already-tracked addresses keep their own window; a success frees another slot.
	trackedSuccess := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	trackedSuccess.RemoteAddr = "192.0.2.0:41000"
	requireStatus(t, h.do(trackedSuccess), http.StatusNoContent)

	afterResetRetry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	afterResetRetry.RemoteAddr = overflowAddr
	requireAPIError(t, h.do(afterResetRetry), http.StatusTooManyRequests, "TooManyRequests")

	rotatedAfterReset := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	rotatedAfterReset.RemoteAddr = "203.0.113.52:41000"
	requireAPIError(t, h.do(rotatedAfterReset), http.StatusTooManyRequests, "TooManyRequests")

	// Once the overflow window expires, the formerly blocked client is admitted normally.
	h.clock.Advance(loginFailureWindow/2 + time.Second)

	afterOverflowExpiry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	afterOverflowExpiry.RemoteAddr = overflowAddr
	requireStatus(t, h.do(afterOverflowExpiry), http.StatusNoContent)
}

func TestValidateAppPasswordMatchesLoginBodyBudget(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		unit string
	}{
		{name: "plain", unit: "a"},
		{name: "quote", unit: `"`},
		{name: "backslash", unit: `\`},
		{name: "tab", unit: "\t"},
		{name: "html", unit: "<"},
		{name: "control", unit: "\x01"},
		{name: "latin", unit: "é"},
		{name: "cjk", unit: "日"},
		{name: "emoji", unit: "😀"},
		{name: "line separator", unit: "\u2028"},
		{name: "paragraph separator", unit: "\u2029"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			password := passwordFillingLoginBudget(t, tt.unit)
			body := encodeLoginRequest(t, password)

			if len(body) != maxLoginBodyBytes {
				t.Fatalf("fixture login body = %d bytes, want exactly %d", len(body), maxLoginBodyBytes)
			}

			if err := ValidateAppPassword(password); err != nil {
				t.Fatalf("ValidateAppPassword() at the budget error = %v, want nil", err)
			}

			h := newHarnessWith(t, func(cfg *Config) { cfg.AppPassword = password })
			requireStatus(t, h.do(unauthenticatedLoginRequest(body)), http.StatusNoContent)

			over := password + "a"

			err := ValidateAppPassword(over)
			if err == nil {
				t.Fatal("ValidateAppPassword() one byte over the budget error = nil, want an error")
			}

			if strings.Contains(err.Error(), over) {
				t.Fatalf("ValidateAppPassword() error leaked the password: %v", err)
			}

			requireAPIError(t, h.do(unauthenticatedLoginRequest(encodeLoginRequest(t, over))), http.StatusBadRequest, "RequestFailed")
		})
	}
}

func TestValidateAppPasswordRejectsUnrepresentableValues(t *testing.T) {
	t.Parallel()

	for _, password := range []string{"", "\xff", "a\nb", "a\rb"} {
		if err := ValidateAppPassword(password); err == nil {
			t.Fatal("ValidateAppPassword() accepted an unauthenticatable password")
		}
	}
}

func TestCSRFOriginAndReferer(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, appURL, method, target, origin, referer, errorCode string
		origins, referers                                        []string
		body                                                     any
		authenticated                                            bool
		want                                                     int
	}{
		{name: "matching origin", origin: testAppURL, want: http.StatusNoContent},
		{name: "default https port", origin: testAppURL + ":443", want: http.StatusNoContent},
		{name: "referer fallback", referer: testAppURL + "/login?next=%2Flater", want: http.StatusNoContent},
		{name: "missing headers", want: http.StatusForbidden},
		{name: "null origin", origin: "null", want: http.StatusForbidden},
		{name: "scheme mismatch", origin: "http://reader.example.com", want: http.StatusForbidden},
		{name: "host mismatch", origin: "https://evil.example.com", want: http.StatusForbidden},
		{name: "port mismatch", origin: "https://reader.example.com:8443", want: http.StatusForbidden},
		{name: "malformed origin", origin: "https://[::1", want: http.StatusForbidden},
		{name: "origin wins over referer", origin: "https://evil.example.com", referer: testAppURL + "/", want: http.StatusForbidden},
		{name: "origin with path", origin: testAppURL + "/app", want: http.StatusForbidden},
		{name: "origin with query", origin: testAppURL + "?next=%2F", want: http.StatusForbidden},
		{name: "origin with fragment", origin: testAppURL + "#frag", want: http.StatusForbidden},
		{name: "origin with credentials", origin: "https://alice:secret@reader.example.com", want: http.StatusForbidden},
		{name: "duplicate origin headers", origins: []string{testAppURL, testAppURL}, want: http.StatusForbidden},
		{name: "empty origin does not fall back to referer", origins: []string{""}, referer: testAppURL + "/login", want: http.StatusForbidden},
		{name: "referer with credentials", referer: "https://alice:secret@reader.example.com/login", want: http.StatusForbidden},
		{name: "data origin", origin: "data:text/html,hi"},
		{name: "about blank origin", origin: "about:blank"},
		{name: "blob origin", origin: "blob:https://reader.example.com/123"},
		{name: "origin trailing query", origin: testAppURL + "?"},
		{name: "origin trailing fragment", origin: testAppURL + "#"},
		{name: "origin trailing colon", origin: testAppURL + ":"},
		{name: "about blank referer", referer: "about:blank"},
		{name: "data referer", referer: "data:text/html,hi"},
		{name: "null referer", referer: "null"},
		{name: "referer trailing colon", referer: testAppURL + ":/login"},
		{name: "duplicate referer", referers: []string{testAppURL + "/login", testAppURL + "/later"}},
		{name: "http explicit port", appURL: "http://reader.example.com", origin: "http://reader.example.com:80", want: http.StatusNoContent},
		{name: "http implicit port", appURL: "http://reader.example.com:80", origin: "http://reader.example.com", want: http.StatusNoContent},
		{name: "https against http", appURL: "http://reader.example.com", origin: "https://reader.example.com:443", want: http.StatusForbidden},
		{name: "saved pages before auth", method: http.MethodPost, target: "/api/saved-pages", body: map[string]any{"url": "https://example.com/post"}, want: http.StatusForbidden},
		{name: "saved pages evil origin", method: http.MethodPost, target: "/api/saved-pages", body: map[string]any{"url": "https://example.com/post"}, authenticated: true, origin: "https://evil.example.com", want: http.StatusForbidden},
		{name: "logout missing origin", method: http.MethodPost, target: "/api/auth/logout", want: http.StatusForbidden},
		{name: "provider missing origin", method: http.MethodPut, target: "/api/settings/provider", body: map[string]any{"provider": "jina"}, authenticated: true, want: http.StatusForbidden},
		{name: "provider evil origin", method: http.MethodPut, target: "/api/settings/provider", body: map[string]any{"provider": "jina"}, authenticated: true, origin: "https://evil.example.com", want: http.StatusForbidden},
		{name: "get skips csrf", method: http.MethodGet, target: "/api/saved-pages", want: http.StatusUnauthorized, errorCode: "Unauthorized"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarnessWith(t, func(cfg *Config) {
				if tc.appURL != "" {
					cfg.AppURL = tc.appURL
				}
			})
			method, target, body := tc.method, tc.target, tc.body
			if method == "" {
				method, target, body = http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword}
			}
			req := h.newRequest(method, target, body)
			req.Header.Del("Origin")
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.referer != "" {
				req.Header.Set("Referer", tc.referer)
			}
			for _, value := range tc.origins {
				req.Header.Add("Origin", value)
			}
			for _, value := range tc.referers {
				req.Header.Add("Referer", value)
			}
			if tc.authenticated {
				req.AddCookie(h.sessionCookie())
			}
			want := tc.want
			if want == 0 {
				want = http.StatusForbidden
			}
			recorder := h.do(req)
			switch {
			case want == http.StatusForbidden:
				requireAPIError(t, recorder, want, "Forbidden")
			case tc.errorCode != "":
				requireAPIError(t, recorder, want, tc.errorCode)
			default:
				requireStatus(t, recorder, want)
			}
		})
	}
}

func TestMissingSessionRejectsAPIRoutes(t *testing.T) {
	t.Parallel()

	requests := []struct {
		method string
		target string
	}{
		{method: http.MethodGet, target: "/api/saved-pages"},
		{method: http.MethodGet, target: "/api/feeds"},
		{method: http.MethodGet, target: "/api/folders"},
		{method: http.MethodGet, target: "/api/feed-items"},
		{method: http.MethodGet, target: "/api/settings"},
		{method: http.MethodPut, target: "/api/settings/retention"},
		{method: http.MethodPut, target: "/api/settings/provider"},
		{method: http.MethodPut, target: "/api/settings/services/jina"},
		{method: http.MethodDelete, target: "/api/settings/services/jina"},
		{method: http.MethodPut, target: "/api/settings/services/browser"},
		{method: http.MethodDelete, target: "/api/settings/services/browser"},
		{method: http.MethodPut, target: "/api/settings/services/smtp"},
		{method: http.MethodDelete, target: "/api/settings/services/smtp"},
		{method: http.MethodDelete, target: "/api/settings/services/smtp/password"},
		{method: http.MethodPut, target: "/api/settings/kindle"},
		{method: http.MethodGet, target: "/api/opml"},
		{method: http.MethodPost, target: "/api/kindle/send"},
		{method: http.MethodPost, target: "/api/saved-pages/read-all"},
		{method: http.MethodDelete, target: "/api/saved-pages/abc"},
	}

	for _, request := range requests {
		t.Run(request.method+" "+request.target, func(t *testing.T) {
			h := newHarness(t)
			requireAPIError(t, h.raw(request.method, request.target, nil), http.StatusUnauthorized, "Unauthorized")
		})
	}
}

func TestHTTPJSONRejectsTrailingTokens(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	cases := []struct {
		name, target, body string
		want               int
	}{
		{"feed trailing JSON", "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}{"url":"https://evil.example.com/rss"}`, http.StatusBadRequest},
		{"read trailing token", "/api/saved-pages/read", `{"ids":[]} trailing`, http.StatusBadRequest},
		{"feed trailing whitespace", "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}` + "\n", http.StatusOK},
		{"login trailing JSON", "/api/auth/login", `{"password":"` + testPassword + `"}{"password":"extra"}`, http.StatusBadRequest},
		{"login oversized", "/api/auth/login", `{"password":"` + strings.Repeat("a", maxLoginBodyBytes) + `"}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := h.do(h.rawRequest(http.MethodPost, tc.target, tc.body))
			if tc.want == http.StatusBadRequest {
				requireAPIError(t, recorder, tc.want, "RequestFailed")
			} else {
				requireStatus(t, recorder, tc.want)
			}
		})
	}
}
