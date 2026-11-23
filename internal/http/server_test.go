package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"reader/internal/domain"
	"reader/internal/sqlite"
)

const (
	testAppURL        = "https://reader.example.com"
	testPassword      = "correct horse battery staple"
	testSessionSecret = "0123456789abcdef0123456789abcdef"
)

func strPtr(value string) *string {
	return &value
}

type testClock struct {
	mu      sync.Mutex
	current time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.current
}

func (c *testClock) Advance(delta time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.current = c.current.Add(delta)
}

// failingSavedPageRepo wraps a real repository for deliberate error/race injection.
type failingSavedPageRepo struct {
	domain.SavedPageRepository
	listErr       error
	unreadErr     error
	bypassGetByID bool
}

func (r *failingSavedPageRepo) List(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.SavedPage], error) {
	if r.listErr != nil {
		return domain.PageResult[domain.SavedPage]{}, r.listErr
	}

	return r.SavedPageRepository.List(ctx, params)
}

func (r *failingSavedPageRepo) UnreadCount(ctx context.Context) (int, error) {
	if r.unreadErr != nil {
		return 0, r.unreadErr
	}

	return r.SavedPageRepository.UnreadCount(ctx)
}

func (r *failingSavedPageRepo) GetByURL(ctx context.Context, target domain.NormalizedURL) (*domain.SavedPage, error) {
	if r.bypassGetByID {
		return nil, nil
	}

	return r.SavedPageRepository.GetByURL(ctx, target)
}

// Adapter doubles used by the HTTP handlers for network, parsing, and worker observation.

type fakeFeedFetcher struct {
	mu       sync.Mutex
	body     []byte
	finalURL string
	err      error
	calls    int
	fetch    func(ctx context.Context, target domain.NormalizedURL) ([]byte, string, error)
}

func (f *fakeFeedFetcher) FetchFeed(ctx context.Context, target domain.NormalizedURL) ([]byte, string, error) {
	f.mu.Lock()
	f.calls++
	fetch := f.fetch
	body := f.body
	finalURL := f.finalURL
	err := f.err
	f.mu.Unlock()

	if fetch != nil {
		return fetch(ctx, target)
	}

	if err != nil {
		return nil, "", err
	}

	return body, finalURL, nil
}

type fakeWebpageFetcher struct {
	mu       sync.Mutex
	html     string
	finalURL string
	err      error
	calls    int
	lastURL  string
	fetch    func(ctx context.Context, target domain.NormalizedURL) (string, string, error)
}

func (f *fakeWebpageFetcher) FetchWebpage(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
	f.mu.Lock()
	f.calls++
	f.lastURL = target.Raw()
	fetch := f.fetch
	html := f.html
	finalURL := f.finalURL
	err := f.err
	f.mu.Unlock()

	if fetch != nil {
		return fetch(ctx, target)
	}

	if err != nil {
		return "", "", err
	}

	return html, finalURL, nil
}

type fakeFeedParser struct {
	parsed domain.ParsedFeed
	err    error
}

func (f *fakeFeedParser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	if f.err != nil {
		return domain.ParsedFeed{}, f.err
	}

	return f.parsed, nil
}

type fakeArticleExtractor struct {
	mu       sync.Mutex
	article  domain.ExtractedArticle
	err      error
	lastHTML string
	lastURL  string
	calls    int
}

func (f *fakeArticleExtractor) ExtractArticle(htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.calls++
	f.lastHTML = htmlBody
	f.lastURL = pageURL
	if f.err != nil {
		return domain.ExtractedArticle{}, f.err
	}

	return f.article, nil
}

type fakeRefresher struct {
	mu      sync.Mutex
	batches [][]string
}

func (f *fakeRefresher) Enqueue(feedIDs ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()

	batch := make([]string, len(feedIDs))
	copy(batch, feedIDs)
	f.batches = append(f.batches, batch)
}

func (f *fakeRefresher) enqueued() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	flattened := make([]string, 0, len(f.batches))
	for _, batch := range f.batches {
		flattened = append(flattened, batch...)
	}

	return flattened
}

type fakeKindleDispatcher struct {
	running bool
	record  domain.KindleSendRecord
	err     error
	calls   int
}

func (f *fakeKindleDispatcher) IsRunning() bool {
	return f.running
}

func (f *fakeKindleDispatcher) EnqueueManual(ctx context.Context) (domain.KindleSendRecord, error) {
	f.calls++
	if f.err != nil {
		return domain.KindleSendRecord{}, f.err
	}

	return f.record, nil
}

type harness struct {
	t         *testing.T
	handler   http.Handler
	db        *sqlite.Store
	clock     *testClock
	refresher *fakeRefresher

	kindle         *fakeKindleDispatcher
	feedFetcher    *fakeFeedFetcher
	feedParser     *fakeFeedParser
	webpageFetcher *fakeWebpageFetcher
	extractor      *fakeArticleExtractor

	cookieMu sync.Mutex
	cookie   *http.Cookie
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	return newHarnessWith(t, nil)
}

func newHarnessWith(t *testing.T, configure func(*Config)) *harness {
	t.Helper()

	db, err := sqlite.Open(context.Background(), filepath.Join(t.TempDir(), "reader.db"))
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}

	t.Cleanup(func() {
		if closeErr := db.Close(); closeErr != nil {
			t.Errorf("close sqlite store: %v", closeErr)
		}
	})

	h := &harness{
		t:              t,
		db:             db,
		clock:          &testClock{current: time.Date(2026, time.March, 1, 8, 0, 0, 0, time.UTC)},
		refresher:      &fakeRefresher{},
		kindle:         &fakeKindleDispatcher{},
		feedFetcher:    &fakeFeedFetcher{},
		feedParser:     &fakeFeedParser{},
		webpageFetcher: &fakeWebpageFetcher{},
		extractor:      &fakeArticleExtractor{},
	}

	cfg := Config{
		AppPassword:   testPassword,
		AppURL:        testAppURL,
		SessionSecret: []byte(testSessionSecret),
		Location:      time.UTC,
		Now:           h.clock.Now,
		HealthCheck:   func(ctx context.Context) error { return db.ReadDB().PingContext(ctx) },

		Folders:     db.Folders(),
		Feeds:       db.Feeds(),
		FeedItems:   db.FeedItems(),
		SavedPages:  db.SavedPages(),
		Settings:    db.Settings(),
		KindleSends: db.KindleSends(),

		FeedFetcher:      h.feedFetcher,
		FeedParser:       h.feedParser,
		WebpageFetcher:   h.webpageFetcher,
		ArticleExtractor: h.extractor,

		Refresher: h.refresher,
		Kindle:    h.kindle,
	}

	if configure != nil {
		configure(&cfg)
	}

	handler, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("new server: %v", err)
	}

	h.handler = handler

	return h
}

func (h *harness) do(req *http.Request) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	h.handler.ServeHTTP(recorder, req)

	return recorder
}

func (h *harness) newRequest(method string, target string, body any) *http.Request {
	h.t.Helper()

	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.t.Fatalf("encode request body: %v", err)
		}

		payload = bytes.NewReader(encoded)
	}

	req := httptest.NewRequest(method, target, payload)
	req.Header.Set("Origin", testAppURL)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return req
}

func (h *harness) rawRequest(method string, target string, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Origin", testAppURL)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(h.sessionCookie())

	return req
}

func (h *harness) raw(method string, target string, body any) *httptest.ResponseRecorder {
	return h.do(h.newRequest(method, target, body))
}

func (h *harness) authed(method string, target string, body any) *httptest.ResponseRecorder {
	req := h.newRequest(method, target, body)
	req.AddCookie(h.sessionCookie())

	return h.do(req)
}

func (h *harness) sessionCookie() *http.Cookie {
	h.t.Helper()

	h.cookieMu.Lock()
	defer h.cookieMu.Unlock()

	if h.cookie != nil {
		return h.cookie
	}

	recorder := h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	if recorder.Code != http.StatusNoContent {
		h.t.Fatalf("login failed: status %d body %s", recorder.Code, recorder.Body.String())
	}

	h.cookie = findCookie(h.t, recorder, sessionCookieName)

	return h.cookie
}

func findCookie(t *testing.T, recorder *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}

	t.Fatalf("response has no %s cookie", name)

	return nil
}

func requireStatus(t *testing.T, recorder *httptest.ResponseRecorder, want int) {
	t.Helper()

	if recorder.Code != want {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, want, recorder.Body.String())
	}
}

func requireJSONContentType(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
}

func requireAPIError(t *testing.T, recorder *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()

	requireStatus(t, recorder, wantStatus)
	requireJSONContentType(t, recorder)

	var payload errorResponse
	decodeBody(t, recorder, &payload)

	if payload.Error != wantCode {
		t.Fatalf("error code = %q, want %q", payload.Error, wantCode)
	}
}

func decodeBody(t *testing.T, recorder *httptest.ResponseRecorder, dst any) {
	t.Helper()

	if err := json.Unmarshal(recorder.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode body %q: %v", recorder.Body.String(), err)
	}
}

func TestNewServerValidatesConfig(t *testing.T) {
	t.Parallel()

	if _, err := NewServer(Config{AppURL: testAppURL, SessionSecret: []byte(testSessionSecret)}); err != nil {
		t.Fatalf("expected valid config: %v", err)
	}

	if _, err := NewServer(Config{AppURL: testAppURL}); err == nil {
		t.Fatal("expected error for missing session secret")
	}

	short := "too-short-secret"
	if _, err := NewServer(Config{AppURL: testAppURL, SessionSecret: []byte(short)}); err == nil {
		t.Fatal("expected error for short session secret")
	} else if strings.Contains(err.Error(), short) {
		t.Fatalf("error leaked session secret: %v", err)
	}

	if _, err := NewServer(Config{AppURL: "://bad", SessionSecret: []byte(testSessionSecret)}); err == nil {
		t.Fatal("expected error for invalid app url")
	}

	if _, err := NewServer(Config{AppURL: "/relative", SessionSecret: []byte(testSessionSecret)}); err == nil {
		t.Fatal("expected error for app url without host")
	}
}

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
	limiter := newLoginLimiter(func() time.Time { return now })

	for i := range maxTrackedLoginIPs * 3 {
		if !limiter.reserveAttempt("192.0.2." + strconv.Itoa(i)) {
			t.Fatalf("first attempt for a fresh ip was rejected")
		}
	}

	limiter.mu.Lock()
	tracked := len(limiter.attempts)
	limiter.mu.Unlock()

	if tracked > maxTrackedLoginIPs {
		t.Fatalf("tracked ips = %d, want <= %d", tracked, maxTrackedLoginIPs)
	}

	// Fill table at t=0, advance half past expiry, and verify expired entries are
	// pruned without evicting unexpired entries.
	clock := now
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

func TestLoginBodyBudgetAndTrailingJSON(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	oversized := `{"password":"` + strings.Repeat("a", maxLoginBodyBytes) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(oversized))
	req.Header.Set("Origin", testAppURL)
	req.Header.Set("Content-Type", "application/json")
	requireAPIError(t, h.do(req), http.StatusBadRequest, "RequestFailed")

	trailing := `{"password":"` + testPassword + `"}{"password":"extra"}`
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(trailing))
	req2.Header.Set("Origin", testAppURL)
	req2.Header.Set("Content-Type", "application/json")
	requireAPIError(t, h.do(req2), http.StatusBadRequest, "RequestFailed")
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

func passwordFillingLoginBudget(t *testing.T, unit string) string {
	t.Helper()

	envelope := len(encodeLoginRequest(t, ""))

	encodedUnit := len(encodeLoginRequest(t, unit)) - envelope
	if encodedUnit <= 0 {
		t.Fatalf("unit %q encodes to %d bytes", unit, encodedUnit)
	}

	budget := maxLoginBodyBytes - envelope
	count := budget / encodedUnit

	return strings.Repeat(unit, count) + strings.Repeat("a", budget-count*encodedUnit)
}

func unauthenticatedLoginRequest(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.Header.Set("Origin", testAppURL)
	req.Header.Set("Content-Type", "application/json")

	return req
}

func encodeLoginRequest(t *testing.T, password string) string {
	t.Helper()

	body, err := json.Marshal(loginRequest{Password: password})
	if err != nil {
		t.Fatalf("encode login request: %v", err)
	}

	return strings.NewReplacer(`\u003c`, "<", `\u003e`, ">", `\u0026`, "&", `\u2028`, "\u2028", `\u2029`, "\u2029").Replace(string(body))
}

func TestAPICacheControlNoStore(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	for _, tc := range []struct {
		name string
		req  *http.Request
	}{
		{name: "public session", req: h.newRequest(http.MethodGet, "/api/auth/session", nil)},
		{name: "unauthorized", req: h.newRequest(http.MethodGet, "/api/folders", nil)},
		{name: "csrf forbidden", req: httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)},
		{name: "api not found", req: func() *http.Request {
			r := h.newRequest(http.MethodGet, "/api/does-not-exist", nil)
			r.AddCookie(h.sessionCookie())
			return r
		}()},
		{name: "opml export", req: func() *http.Request {
			r := h.newRequest(http.MethodGet, "/api/opml", nil)
			r.AddCookie(h.sessionCookie())
			return r
		}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := h.do(tc.req)
			if got := recorder.Header().Get("Cache-Control"); got != apiCacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, apiCacheControl)
			}
		})
	}
}

func TestCSRFOriginAndReferer(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name            string
		origin          string
		referer         string
		emptyOrigin     bool
		duplicateOrigin bool
		want            int
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
		{name: "duplicate origin headers", duplicateOrigin: true, want: http.StatusForbidden},
		{name: "empty origin does not fall back to referer", emptyOrigin: true, referer: testAppURL + "/login", want: http.StatusForbidden},
		{name: "referer with credentials", referer: "https://alice:secret@reader.example.com/login", want: http.StatusForbidden},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
			req.Header.Del("Origin")

			switch {
			case testCase.duplicateOrigin:
				req.Header.Add("Origin", testAppURL)
				req.Header.Add("Origin", testAppURL)
			case testCase.emptyOrigin:
				req.Header.Set("Origin", "")
			case testCase.origin != "":
				req.Header.Set("Origin", testCase.origin)
			}

			if testCase.referer != "" {
				req.Header.Set("Referer", testCase.referer)
			}

			recorder := h.do(req)
			requireStatus(t, recorder, testCase.want)

			if testCase.want == http.StatusForbidden {
				requireAPIError(t, recorder, http.StatusForbidden, "Forbidden")
			}
		})
	}
}

func TestCSRFGuardsStateChangingAPIRoutes(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	req := h.newRequest(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post"})
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post"})
	req.AddCookie(h.sessionCookie())
	req.Header.Set("Origin", "https://evil.example.com")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPost, "/api/auth/logout", nil)
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"})
	req.AddCookie(h.sessionCookie())
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"})
	req.AddCookie(h.sessionCookie())
	req.Header.Set("Origin", "https://evil.example.com")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	// GET requests are not CSRF protected; they fail authentication instead.
	req = h.newRequest(http.MethodGet, "/api/saved-pages", nil)
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusUnauthorized, "Unauthorized")
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

func (h *harness) seedFolder(name string) domain.Folder {
	h.t.Helper()

	folder, err := h.db.Folders().Create(context.Background(), domain.NewID(), name)
	if err != nil {
		h.t.Fatalf("seed folder %q: %v", name, err)
	}

	return folder
}

func (h *harness) seedFeed(title string, rawURL string, folderID *string) domain.Feed {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		h.t.Fatalf("seed feed url %q: %v", rawURL, err)
	}

	created, err := h.db.Feeds().Create(context.Background(), domain.Feed{
		ID:         domain.NewID(),
		URL:        normalized,
		Title:      title,
		FolderID:   folderID,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	})
	if err != nil {
		h.t.Fatalf("seed feed %q: %v", rawURL, err)
	}

	return created
}

func (h *harness) seedItem(feedID string, rawURL string, configure func(*domain.FeedItem)) domain.FeedItem {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		h.t.Fatalf("seed item url %q: %v", rawURL, err)
	}

	item := domain.FeedItem{ID: domain.NewID(), FeedID: feedID, URL: normalized, Title: "Item"}
	if configure != nil {
		configure(&item)
	}

	ctx := context.Background()
	feed := h.feedByID(feedID)
	if feed == nil {
		h.t.Fatalf("seed item: unknown feed %s", feedID)
	}

	if err := h.db.Feeds().ApplySync(ctx, feedID, feed.Title, h.clock.Now(), []domain.FeedItem{item}, nil); err != nil {
		h.t.Fatalf("seed item %q: %v", rawURL, err)
	}

	if item.Read {
		if err := h.db.FeedItems().SetRead(ctx, item.ID, true); err != nil {
			h.t.Fatalf("seed item read %q: %v", rawURL, err)
		}
	}

	return item
}

func (h *harness) seedSavedPage(rawURL string, read bool) domain.SavedPage {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrInvalidPageUrl)
	if err != nil {
		h.t.Fatalf("seed saved page url %q: %v", rawURL, err)
	}

	ctx := context.Background()
	created, err := h.db.SavedPages().Create(ctx, domain.SavedPage{
		ID:      domain.NewID(),
		URL:     normalized,
		Title:   "Saved",
		Content: "<p>saved</p>",
		Read:    read,
	})
	if err != nil {
		h.t.Fatalf("seed saved page %q: %v", rawURL, err)
	}

	return created
}

func (h *harness) folderByID(id string) *domain.Folder {
	h.t.Helper()

	folder, err := h.db.Folders().GetByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("folderByID %s: %v", id, err)
	}

	return folder
}

func (h *harness) feedByID(id string) *domain.Feed {
	h.t.Helper()

	feed, err := h.db.Feeds().GetByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("feedByID %s: %v", id, err)
	}

	return feed
}

func (h *harness) feedItemByID(id string) *domain.FeedItem {
	h.t.Helper()

	item, err := h.db.FeedItems().GetByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("feedItemByID %s: %v", id, err)
	}

	return item
}

func (h *harness) savedByID(id string) *domain.SavedPage {
	h.t.Helper()

	page, err := h.db.SavedPages().GetByID(context.Background(), id)
	if err != nil {
		h.t.Fatalf("savedByID %s: %v", id, err)
	}

	return page
}

func (h *harness) allSavedPages() []domain.SavedPage {
	h.t.Helper()

	res, err := h.db.SavedPages().List(context.Background(), domain.PageParams{Limit: 200})
	if err != nil {
		h.t.Fatalf("list saved pages: %v", err)
	}

	return res.Items
}

func (h *harness) allFeeds() []domain.Feed {
	h.t.Helper()

	feeds, err := h.db.Feeds().List(context.Background())
	if err != nil {
		h.t.Fatalf("list feeds: %v", err)
	}

	return feeds
}

func (h *harness) allFolders() []domain.Folder {
	h.t.Helper()

	folders, err := h.db.Folders().List(context.Background())
	if err != nil {
		h.t.Fatalf("list folders: %v", err)
	}

	return folders
}

func (h *harness) loadSettings() domain.Settings {
	h.t.Helper()

	s, err := h.db.Settings().Get(context.Background())
	if err != nil {
		h.t.Fatalf("get settings: %v", err)
	}

	return s
}

func TestSavedPageCreateAndDuplicate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	published := time.Date(2024, time.May, 1, 12, 0, 0, 0, time.UTC)
	h.webpageFetcher.html = "<html><body><p>hi</p></body></html>"
	h.webpageFetcher.finalURL = "https://example.com/redirected"
	h.extractor.article = domain.ExtractedArticle{
		Title:       "Hello",
		Description: strPtr("desc"),
		Content:     "<p>hi</p>",
		PublishedAt: &published,
	}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": " https://example.com/post?utm_source=news&id=7 "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("created response has no item")
	}

	if created.Item.URL != "https://example.com/post?id=7" {
		t.Fatalf("stored url = %q, want the submitted normalized url", created.Item.URL)
	}

	if created.Item.Title != "Hello" || created.Item.Content != "<p>hi</p>" {
		t.Fatalf("created item = %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "desc" {
		t.Fatalf("created description = %v", created.Item.Description)
	}

	if created.Item.PublishedAt == nil || *created.Item.PublishedAt != "2024-05-01T12:00:00Z" {
		t.Fatalf("created publishedAt = %v", created.Item.PublishedAt)
	}

	if created.Item.Read {
		t.Fatal("a new saved page must be unread")
	}

	if h.webpageFetcher.calls != 1 || h.extractor.calls != 1 {
		t.Fatalf("fetch/extract calls = %d/%d", h.webpageFetcher.calls, h.extractor.calls)
	}

	if h.webpageFetcher.lastURL != "https://example.com/post?id=7" {
		t.Fatalf("fetched url = %q", h.webpageFetcher.lastURL)
	}

	duplicate := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post?id=7&utm_campaign=again"})
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/post?id=7" || conflict.ID != created.Item.ID {
		t.Fatalf("conflict = %+v, want url=%q id=%q", conflict, "https://example.com/post?id=7", created.Item.ID)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatal("duplicate detection must run before fetching the webpage")
	}
}

func TestSavedPageCreateConflictAtInsertReturnsID(t *testing.T) {
	t.Parallel()

	var wrapped *failingSavedPageRepo
	h := newHarnessWith(t, func(cfg *Config) {
		wrapped = &failingSavedPageRepo{SavedPageRepository: cfg.SavedPages, bypassGetByID: true}
		cfg.SavedPages = wrapped
	})

	existing := h.seedSavedPage("https://user:secret@example.com/race", false)
	h.webpageFetcher.html = "<html><body><p>hi</p></body></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Hello", Content: "<p>hi</p>"}

	duplicate := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://user:secret@example.com/race?utm_source=x"})
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.ID != existing.ID {
		t.Fatalf("conflict id = %q, want %q", conflict.ID, existing.ID)
	}

	if conflict.URL != "https://example.com/race" || strings.Contains(duplicate.Body.String(), "secret") {
		t.Fatalf("conflict leaked or mismatched url: %s", duplicate.Body.String())
	}
}

func TestSavedPageRedactsURLCredentials(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.webpageFetcher.html = "<p>private</p>"
	h.extractor.article = domain.ExtractedArticle{Title: "Private", Content: "<p>private</p>"}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://user:supersecret@example.com/private"})
	requireStatus(t, recorder, http.StatusCreated)

	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("response leaked url credentials: %s", recorder.Body.String())
	}

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item.URL != "https://example.com/private" {
		t.Fatalf("url = %q", created.Item.URL)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireStatus(t, recorder, http.StatusOK)
	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("list leaked url credentials: %s", recorder.Body.String())
	}
}

func TestSavedPageValidationAndUpstreamFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		body       map[string]any
		fetchErr   error
		extractErr error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "unsupported scheme",
			body:       map[string]any{"url": "ftp://example.com/file"},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "empty url",
			body:       map[string]any{"url": "   "},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "fetch failure",
			body:       map[string]any{"url": "https://example.com/post"},
			fetchErr:   domain.NewError(domain.ErrWebpageFetcherError, errors.New("dial tcp 10.0.0.1: connect: connection refused")),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "WebpageFetcherError",
		},
		{
			name:       "empty article",
			body:       map[string]any{"url": "https://example.com/post"},
			extractErr: domain.NewError(domain.ErrArticleEmptyContent, nil),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "ArticleEmptyContent",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			h.webpageFetcher.err = testCase.fetchErr
			h.extractor.err = testCase.extractErr

			recorder := h.authed(http.MethodPost, "/api/saved-pages", testCase.body)
			requireAPIError(t, recorder, testCase.wantStatus, testCase.wantCode)

			if strings.Contains(recorder.Body.String(), "10.0.0.1") {
				t.Fatalf("error response leaked the internal cause: %s", recorder.Body.String())
			}

			if pages := h.allSavedPages(); len(pages) != 0 {
				t.Fatalf("failed create persisted %d pages", len(pages))
			}
		})
	}
}

func TestSavedPageGet(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/saved", false)

	byID := h.authed(http.MethodGet, "/api/saved-pages/"+page.ID, nil)
	requireStatus(t, byID, http.StatusOK)

	var fetched itemResponse[savedPageJSON]
	decodeBody(t, byID, &fetched)
	if fetched.Item == nil || fetched.Item.ID != page.ID {
		t.Fatalf("get item = %+v", fetched.Item)
	}

	unknown := h.authed(http.MethodGet, "/api/saved-pages/"+domain.NewID(), nil)
	requireStatus(t, unknown, http.StatusOK)
	decodeBody(t, unknown, &fetched)
	if fetched.Item != nil {
		t.Fatalf("unknown id returned %+v", fetched.Item)
	}
}

func TestSavedPagePagingAndReadState(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	first := h.seedSavedPage("https://example.com/1", false)
	second := h.seedSavedPage("https://example.com/2", false)
	third := h.seedSavedPage("https://example.com/3", false)

	recorder := h.authed(http.MethodGet, "/api/saved-pages?limit=2", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[savedPageJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 || page.Items[0].ID != third.ID || page.Items[1].ID != second.ID {
		t.Fatalf("first page = %+v", page.Items)
	}

	if page.Cursor == nil || *page.Cursor != second.ID {
		t.Fatalf("first page cursor = %v", page.Cursor)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?limit=2&cursor="+*page.Cursor, nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != first.ID {
		t.Fatalf("second page = %+v", page.Items)
	}

	if page.Cursor != nil {
		t.Fatalf("last page cursor must be null, got %q", *page.Cursor)
	}

	if err := h.db.SavedPages().SetRead(context.Background(), second.ID, true); err != nil {
		t.Fatalf("set saved page read: %v", err)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 {
		t.Fatalf("unread filter returned %d items", len(page.Items))
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread=false", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 3 {
		t.Fatalf("unread=false returned %d items", len(page.Items))
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?unread=maybe", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=0", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=201", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?cursor=not-a-uuid", nil), http.StatusBadRequest, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil)
	requireStatus(t, recorder, http.StatusOK)

	var count countResponse
	decodeBody(t, recorder, &count)
	if count.Count != 2 {
		t.Fatalf("unread count = %d", count.Count)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+third.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.savedByID(third.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read", map[string]any{"ids": []string{first.ID}}), http.StatusNoContent)
	if !h.savedByID(first.ID).Read {
		t.Fatal("POST read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read-all", nil), http.StatusNoContent)
	for _, saved := range h.allSavedPages() {
		if !saved.Read {
			t.Fatalf("page %s still unread after read-all", saved.ID)
		}
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/saved-pages/"+second.ID, nil), http.StatusNoContent)

	recorder = h.authed(http.MethodGet, "/api/saved-pages/"+second.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[savedPageJSON]
	decodeBody(t, recorder, &single)
	if single.Item != nil {
		t.Fatal("deleted page is still returned")
	}
}

func TestSavedPageRepositoryErrorsAreSanitized(t *testing.T) {
	t.Parallel()

	repoErr := domain.NewError(domain.ErrSavedPageRepositoryError, errors.New("sqlite: disk I/O error at /data/reader.db"))
	h := newHarnessWith(t, func(cfg *Config) {
		cfg.SavedPages = &failingSavedPageRepo{
			SavedPageRepository: cfg.SavedPages,
			listErr:             repoErr,
			unreadErr:           repoErr,
		}
	})

	recorder := h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireAPIError(t, recorder, http.StatusInternalServerError, "SavedPageRepositoryError")

	if strings.Contains(recorder.Body.String(), "disk I/O error") {
		t.Fatalf("response leaked the internal cause: %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil), http.StatusInternalServerError, "SavedPageRepositoryError")
}

func TestFeedItemSave(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Feed", "https://feeds.example.com/rss", nil)
	extracted := h.seedItem(feed.ID, "https://example.com/extracted", func(item *domain.FeedItem) {
		item.Title = "Extracted"
		item.Description = strPtr("feed description")
		item.ExtractedContent = strPtr("<p>extracted</p>")
	})
	withContent := h.seedItem(feed.ID, "https://example.com/content", func(item *domain.FeedItem) {
		item.Content = strPtr("<p>content</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", func(item *domain.FeedItem) {
		item.Title = "Bare"
	})
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Fetched", Content: "<p>fetched</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Content != "<p>extracted</p>" {
		t.Fatalf("extracted content was not reused: %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "feed description" {
		t.Fatalf("description = %v", created.Item.Description)
	}

	if created.Item.Read {
		t.Fatal("saved copies must start unread")
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with extracted content must not fetch the webpage")
	}

	duplicate := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/extracted" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+withContent.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>content</p>" {
		t.Fatalf("feed content was not reused: %+v", created.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with feed content must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>fetched</p>" || created.Item.Title != "Fetched" {
		t.Fatalf("fetched save = %+v", created.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("expected one webpage fetch, got %d", h.webpageFetcher.calls)
	}

	missing := h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/save", nil)
	requireAPIError(t, missing, http.StatusNotFound, "FeedItemNotFound")
}

func TestFeedPreview(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.feedFetcher.body = []byte("<rss></rss>")
	h.feedFetcher.finalURL = "https://feeds.example.com/final"
	h.feedParser.parsed = domain.ParsedFeed{
		Title:       "   ",
		Description: strPtr("feed description"),
		Entries: []domain.ParsedFeedEntry{
			{Title: "one"},
			{Title: "two"},
			{Title: "three"},
			{Title: "four"},
		},
	}

	recorder := h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireStatus(t, recorder, http.StatusOK)

	var preview feedPreviewResponse
	decodeBody(t, recorder, &preview)

	if preview.Preview.URL != "https://feeds.example.com/rss" {
		t.Fatalf("preview url = %q", preview.Preview.URL)
	}

	if preview.Preview.Title != "feeds.example.com" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if joined := strings.Join(preview.Preview.Titles, ","); joined != "one,two,three" {
		t.Fatalf("preview titles = %q", joined)
	}

	if preview.Preview.Description == nil || *preview.Preview.Description != "feed description" {
		t.Fatalf("preview description = %v", preview.Preview.Description)
	}

	h.feedParser.parsed = domain.ParsedFeed{Title: "Go Blog", Entries: nil}
	recorder = h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"})
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &preview)

	if preview.Preview.Title != "Go Blog" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if preview.Preview.Titles == nil || len(preview.Preview.Titles) != 0 {
		t.Fatalf("empty titles must serialize as [], got %+v", preview.Preview.Titles)
	}

	if !strings.Contains(recorder.Body.String(), `"titles":[]`) {
		t.Fatalf("empty titles JSON = %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "javascript:alert(1)"}), http.StatusBadRequest, "FeedUrlInvalid")

	h.feedFetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("boom"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FetchFeedError")

	h.feedFetcher.err = nil
	h.feedParser.err = domain.NewError(domain.ErrFeedParserError, errors.New("bad xml"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FeedParserError")
}

func TestFeedSubscribe(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")

	recorder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss", "folderId": folder.ID})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[feedJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("subscribe response has no item")
	}

	if created.Item.Title != "feeds.example.com" {
		t.Fatalf("default title = %q", created.Item.Title)
	}

	if created.Item.ReaderMode != domain.ReaderModeDefault || created.Item.Order != domain.SortOrderNewest {
		t.Fatalf("defaults = %s/%s", created.Item.ReaderMode, created.Item.Order)
	}

	if created.Item.FolderID == nil || *created.Item.FolderID != folder.ID {
		t.Fatalf("folderId = %v", created.Item.FolderID)
	}

	if enqueued := h.refresher.enqueued(); len(enqueued) != 1 || enqueued[0] != created.Item.ID {
		t.Fatalf("refresh enqueue = %+v", h.refresher.batches)
	}

	recorder = h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://second.example.com/rss", "title": "  Go Blog  "})
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Title != "Go Blog" {
		t.Fatalf("explicit title = %q", created.Item.Title)
	}

	duplicate := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireAPIError(t, duplicate, http.StatusConflict, "FeedAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://feeds.example.com/rss" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	missingFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://third.example.com/rss", "folderId": domain.NewID()})
	requireAPIError(t, missingFolder, http.StatusNotFound, "FolderNotFound")

	invalidURL := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": ""})
	requireAPIError(t, invalidURL, http.StatusBadRequest, "FeedUrlInvalid")
}

func TestFeedPreferencesAndDelete(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "extracted"}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).ReaderMode; got != domain.ReaderModeExtracted {
		t.Fatalf("reader mode = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "bogus"}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "oldest"}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).Order; got != domain.SortOrderOldest {
		t.Fatalf("order = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "bogus"}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": folder.ID}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("move to folder = %v", got)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": nil}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).FolderID; got != nil {
		t.Fatalf("move to top level = %v", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": domain.NewID()}), http.StatusNotFound, "FolderNotFound")

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/refresh", nil), http.StatusAccepted)
	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+domain.NewID()+"/refresh", nil), http.StatusAccepted)
	if batches := h.refresher.batches; len(batches) != 1 || len(batches[0]) != 1 || batches[0][0] != feed.ID {
		t.Fatalf("refresh enqueue = %+v", batches)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/feeds/"+feed.ID, nil), http.StatusNoContent)
	if h.feedByID(feed.ID) != nil {
		t.Fatal("feed was not deleted")
	}
}

func TestFeedMoveRequiresFolderIDKey(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)

	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": 42}), http.StatusBadRequest, "RequestFailed")
	if got := h.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("missing folderId must not move feed: %v", got)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": nil}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).FolderID; got != nil {
		t.Fatalf("explicit null must move feed to top level: %v", got)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": "  " + folder.ID + "  "}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("folderId must move feed: %v", got)
	}
}

func TestReadStateRequiresExplicitFlag(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/page", false)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/item", nil)

	requireAPIError(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{"read": true}), http.StatusNoContent)
	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{"read": false}), http.StatusNoContent)
	if h.savedByID(page.ID).Read {
		t.Fatal("explicit read:false did not mark saved page unread")
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{"read": true}), http.StatusNoContent)
	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{"read": false}), http.StatusNoContent)
	if h.feedItemByID(item.ID).Read {
		t.Fatal("explicit read:false did not mark feed item unread")
	}
}
func TestHTTPJSONRejectsTrailingTokens(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.do(h.rawRequest(http.MethodPost, "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}{"url":"https://evil.example.com/rss"}`))
	requireAPIError(t, recorder, http.StatusBadRequest, "RequestFailed")

	recorder = h.do(h.rawRequest(http.MethodPost, "/api/saved-pages/read", `{"ids":[]} trailing`))
	requireAPIError(t, recorder, http.StatusBadRequest, "RequestFailed")

	recorder = h.do(h.rawRequest(http.MethodPost, "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}`+"\n"))
	requireStatus(t, recorder, http.StatusOK)
}

func TestFeedItemOrdering(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	oldestFeed := h.seedFeed("Oldest", "https://feeds.example.com/oldest", nil)
	if err := h.db.Feeds().UpdateOrder(context.Background(), oldestFeed.ID, domain.SortOrderOldest); err != nil {
		t.Fatalf("update feed order: %v", err)
	}
	newestFeed := h.seedFeed("Newest", "https://feeds.example.com/newest", nil)

	first := h.seedItem(oldestFeed.ID, "https://example.com/first", nil)
	second := h.seedItem(oldestFeed.ID, "https://example.com/second", nil)
	other := h.seedItem(newestFeed.ID, "https://example.com/other", nil)

	recorder := h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[feedItemJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 || page.Items[0].ID != first.ID || page.Items[1].ID != second.ID {
		t.Fatalf("stored oldest order ignored: %+v", page.Items)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=newest", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if page.Items[0].ID != second.ID || page.Items[1].ID != first.ID {
		t.Fatalf("explicit newest order ignored: %+v", page.Items)
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=bogus", nil), http.StatusBadRequest, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api/feed-items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 3 || page.Items[0].ID != other.ID {
		t.Fatalf("all items must be newest first: %+v", page.Items)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?limit=1", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Cursor == nil || *page.Cursor != first.ID {
		t.Fatalf("paged feed items = %+v cursor %v", page.Items, page.Cursor)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+domain.NewID()+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if page.Items == nil || len(page.Items) != 0 || page.Cursor != nil {
		t.Fatalf("unknown feed page = %+v", page)
	}

	if !strings.Contains(recorder.Body.String(), `"items":[]`) {
		t.Fatalf("empty page items must serialize as []: %s", recorder.Body.String())
	}
}

func TestFeedItemReadStateAndCounts(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	first := h.seedItem(feed.ID, "https://example.com/1", nil)
	second := h.seedItem(feed.ID, "https://example.com/2", nil)

	recorder := h.authed(http.MethodGet, "/api/feed-items/"+first.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[feedItemJSON]
	decodeBody(t, recorder, &single)
	if single.Item == nil || single.Item.ID != first.ID || single.Item.FeedID != feed.ID {
		t.Fatalf("item = %+v", single.Item)
	}

	recorder = h.authed(http.MethodGet, "/api/feed-items/"+domain.NewID(), nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), `"item":null`) {
		t.Fatalf("unknown item body = %s", recorder.Body.String())
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/unread-counts", nil)
	requireStatus(t, recorder, http.StatusOK)

	var counts listResponse[feedUnreadCountJSON]
	decodeBody(t, recorder, &counts)
	if len(counts.Items) != 1 || counts.Items[0].FeedID != feed.ID || counts.Items[0].Count != 2 {
		t.Fatalf("unread counts = %+v", counts.Items)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+first.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.feedItemByID(first.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read", map[string]any{"ids": []string{second.ID}}), http.StatusNoContent)
	if !h.feedItemByID(second.ID).Read {
		t.Fatal("POST read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", nil), http.StatusNoContent)

	third := h.seedItem(feed.ID, "https://example.com/3", nil)
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read-all", nil), http.StatusNoContent)
	if !h.feedItemByID(third.ID).Read {
		t.Fatal("read-all did not mark items read")
	}
}

func TestFeedItemExtract(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	cached := h.seedItem(feed.ID, "https://example.com/cached", func(item *domain.FeedItem) {
		item.ExtractedContent = strPtr("<p>cached</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", nil)
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Extracted", Content: "<p>extracted</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+cached.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)

	var extracted itemResponse[feedItemJSON]
	decodeBody(t, recorder, &extracted)
	if extracted.Item == nil || extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>cached</p>" {
		t.Fatalf("cached item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("cached extraction must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &extracted)
	if extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>extracted</p>" {
		t.Fatalf("extracted item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("webpage fetch calls = %d", h.webpageFetcher.calls)
	}

	stored := h.feedItemByID(bare.ID)
	if stored.ExtractedContent == nil || *stored.ExtractedContent != "<p>extracted</p>" {
		t.Fatal("extracted content was not stored")
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/extract", nil), http.StatusNotFound, "FeedItemNotFound")

	h.extractor.err = domain.NewError(domain.ErrArticleExtractorError, errors.New("readability failed"))
	failing := h.seedItem(feed.ID, "https://example.com/failing", nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+failing.ID+"/extract", nil), http.StatusUnprocessableEntity, "ArticleExtractorError")
}

func TestFeedItemExtractCoalescesAndFirstWriterWins(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/race", nil)

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		return "<html></html>", target.Raw(), nil
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Second", Content: "<p>second</p>"}

	var (
		wg  sync.WaitGroup
		rec [2]*httptest.ResponseRecorder
	)
	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec[idx] = h.authed(http.MethodPost, "/api/feed-items/"+item.ID+"/extract", nil)
		}(i)
	}

	<-started

	// Simulate an independent worker winning the race before extract finishes.
	if _, wrote, err := h.db.FeedItems().SaveExtractedContentIfEmpty(context.Background(), item.ID, "<p>first</p>"); err != nil || !wrote {
		t.Fatalf("first writer failed: wrote=%v err=%v", wrote, err)
	}

	close(release)
	wg.Wait()

	for i, r := range rec {
		requireStatus(t, r, http.StatusOK)
		var resp itemResponse[feedItemJSON]
		decodeBody(t, r, &resp)
		if resp.Item == nil || resp.Item.ExtractedContent == nil || *resp.Item.ExtractedContent != "<p>first</p>" {
			t.Fatalf("response %d = %+v, want first-writer content", i, resp.Item)
		}
	}

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if calls != 1 {
		t.Fatalf("webpage fetch calls = %d, want 1 (coalesced)", calls)
	}
}

func TestForegroundFetchSemaphoreBoundsConcurrency(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	entered := make(chan struct{}, maxConcurrentForegroundFetches+2)
	release := make(chan struct{})

	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		entered <- struct{}{}
		select {
		case <-release:
			return "<html></html>", target.Raw(), nil
		case <-ctx.Done():
			return "", "", ctx.Err()
		}
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Ok", Content: "<p>ok</p>"}

	var wg sync.WaitGroup
	for i := range maxConcurrentForegroundFetches {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/sem/" + strconv.Itoa(idx)})
			requireStatus(t, rec, http.StatusCreated)
		}(i)
	}

	for range maxConcurrentForegroundFetches {
		<-entered
	}

	// Fifth request enters acquireFetchSlot and aborts when its context cancels.
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	req := h.newRequest(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/sem/overflow"}).WithContext(ctx)
	req.AddCookie(h.sessionCookie())
	requireAPIError(t, h.do(req), http.StatusInternalServerError, "RequestFailed")

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if calls != maxConcurrentForegroundFetches {
		t.Fatalf("fetch calls = %d, want %d", calls, maxConcurrentForegroundFetches)
	}

	close(release)
	wg.Wait()
}

func TestFolderCRUD(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "  Tech  "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[folderJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Name != "Tech" {
		t.Fatalf("created folder = %+v", created.Item)
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "   "}), http.StatusBadRequest, "InvalidFolderName")
	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "Tech"}), http.StatusConflict, "FolderAlreadyExists")

	requireStatus(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": "Technology"}), http.StatusNoContent)
	if got := h.folderByID(created.Item.ID).Name; got != "Technology" {
		t.Fatalf("renamed folder = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+domain.NewID(), map[string]any{"name": "Nope"}), http.StatusNotFound, "FolderNotFound")

	other := h.seedFolder("Life")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": other.Name}), http.StatusConflict, "FolderAlreadyExists")

	recorder = h.authed(http.MethodGet, "/api/folders", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[folderJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 2 || listed.Items[0].Name != "Life" || listed.Items[1].Name != "Technology" {
		t.Fatalf("folder list = %+v", listed.Items)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+created.Item.ID, nil), http.StatusNoContent)
	if h.folderByID(created.Item.ID) != nil {
		t.Fatal("folder was not deleted")
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+domain.NewID(), nil), http.StatusNoContent)
}

func TestFolderDeleteMovesFeedsToTopLevel(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+folder.ID, nil), http.StatusNoContent)

	moved := h.feedByID(feed.ID)
	if moved == nil {
		t.Fatal("deleting a folder must not delete its feeds")
	}

	if moved.FolderID != nil {
		t.Fatalf("feed folder after delete = %v", moved.FolderID)
	}

	recorder := h.authed(http.MethodGet, "/api/feeds", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[feedJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 1 {
		t.Fatalf("feeds = %+v", listed.Items)
	}

	if listed.Items[0].FolderID != nil {
		t.Fatalf("top-level feed serialized folderId = %v", *listed.Items[0].FolderID)
	}

	if strings.Contains(recorder.Body.String(), `"folderId"`) {
		t.Fatalf("absent folderId must be omitted: %s", recorder.Body.String())
	}
}

func TestFolderItemsAndReadAll(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	inFolder := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	outside := h.seedFeed("Other", "https://other.example.com/rss", nil)
	read := h.seedItem(inFolder.ID, "https://example.com/read", func(item *domain.FeedItem) { item.Read = true })
	unread := h.seedItem(inFolder.ID, "https://example.com/unread", nil)
	h.seedItem(outside.ID, "https://example.com/outside", nil)

	recorder := h.authed(http.MethodGet, "/api/folders/"+folder.ID+"/items?unread", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[feedItemJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != unread.ID {
		t.Fatalf("folder unread items = %+v", page.Items)
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/folders/"+folder.ID+"/read-all", nil), http.StatusNoContent)
	if !h.feedItemByID(unread.ID).Read || !h.feedItemByID(read.ID).Read {
		t.Fatal("folder read-all did not mark items read")
	}

	recorder = h.authed(http.MethodGet, "/api/folders/"+domain.NewID()+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 0 {
		t.Fatalf("unknown folder items = %+v", page.Items)
	}
}

func TestOPMLExport(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	h.seedFeed("Top Feed", "https://top.example.com/rss", nil)
	h.seedFeed("Private", "https://user:supersecret@private.example.com/rss", &folder.ID)

	recorder := h.authed(http.MethodGet, "/api/opml", nil)
	requireStatus(t, recorder, http.StatusOK)

	if contentType := recorder.Header().Get("Content-Type"); contentType != "text/x-opml+xml; charset=utf-8" {
		t.Fatalf("content type = %q", contentType)
	}

	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, `filename="subscriptions.opml"`) {
		t.Fatalf("content disposition = %q", disposition)
	}

	body := recorder.Body.String()
	wanted := []string{
		`<outline text="Tech"`,
		`xmlUrl="https://private.example.com/rss"`,
		`xmlUrl="https://top.example.com/rss"`,
		`version="2.0"`,
	}
	for _, want := range wanted {
		if !strings.Contains(body, want) {
			t.Fatalf("opml export is missing %q:\n%s", want, body)
		}
	}

	if strings.Contains(body, "supersecret") {
		t.Fatalf("opml export leaked url credentials:\n%s", body)
	}
}

func TestOPMLImportRawXML(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.seedFeed("Go Blog", "https://go.example.com/rss", nil)

	document := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline type="rss" text="Go Blog" xmlUrl="https://go.example.com/rss"/>
      <outline type="rss" text="Rust Blog" xmlUrl="https://rust.example.com/rss?utm_source=opml"/>
    </outline>
  </body>
</opml>`

	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(document))
	req.Header.Set("Content-Type", "text/x-opml+xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 1 || result.SkippedFeeds != 1 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	enqueued := h.refresher.enqueued()
	if len(enqueued) != 1 {
		t.Fatalf("refresher batches = %+v", h.refresher.batches)
	}

	feeds := h.allFeeds()
	var imported *domain.Feed
	for i := range feeds {
		if feeds[i].URL.RedactedString() == "https://rust.example.com/rss" {
			imported = &feeds[i]
		}
	}

	if imported == nil {
		t.Fatalf("imported feed missing: %+v", feeds)
	}

	if enqueued[0] != imported.ID {
		t.Fatalf("enqueued %q, want new feed %q", enqueued[0], imported.ID)
	}

	folders := h.allFolders()
	var tech *domain.Folder
	for i := range folders {
		if folders[i].Name == "Tech" {
			tech = &folders[i]
		}
	}

	if tech == nil {
		t.Fatal("folder Tech was not created")
	}

	if imported.FolderID == nil || *imported.FolderID != tech.ID {
		t.Fatalf("imported folder = %v", imported.FolderID)
	}

	for _, feed := range feeds {
		if feed.URL.RedactedString() == "https://go.example.com/rss" && feed.FolderID != nil {
			t.Fatal("a skipped duplicate must not be moved into the imported folder")
		}
	}
}

func TestOPMLImportMultipart(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	document := `<opml version="2.0"><body><outline text="News"><outline type="rss" text="A" xmlUrl="https://a.example.com/rss"/><outline type="rss" text="B" xmlUrl="https://b.example.com/rss"/></outline></body></opml>`

	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	part, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}

	if _, err := part.Write([]byte(document)); err != nil {
		t.Fatalf("write form file: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(payload.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 2 || result.SkippedFeeds != 0 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	if enqueued := h.refresher.enqueued(); len(enqueued) != 2 {
		t.Fatalf("enqueued = %+v", h.refresher.batches)
	}
}

func TestOPMLImportRejectsInvalidDocument(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader("<rss><channel/></rss>"))
	req.Header.Set("Content-Type", "text/xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireAPIError(t, recorder, http.StatusBadRequest, "InvalidOpml")

	if len(h.allFeeds()) != 0 || len(h.allFolders()) != 0 {
		t.Fatal("invalid OPML must not write anything")
	}

	if len(h.refresher.batches) != 0 {
		t.Fatalf("invalid OPML must not enqueue refreshes: %+v", h.refresher.batches)
	}
}

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

func TestRemovedSettingsRoutes(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	removed := []struct {
		method string
		target string
	}{
		{method: http.MethodPut, target: "/api/settings/fetcher/direct"},
		{method: http.MethodPut, target: "/api/settings/fetcher/jina"},
		{method: http.MethodPut, target: "/api/settings/fetcher/browser"},
		{method: http.MethodDelete, target: "/api/settings/fetcher/jina/key"},
		{method: http.MethodDelete, target: "/api/settings/kindle/password"},
	}

	for _, route := range removed {
		recorder := h.authed(route.method, route.target, nil)
		if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s status = %d, want 404 or 405: %s", route.method, route.target, recorder.Code, recorder.Body.String())
		}
	}
}

func TestKindleSend(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	h.kindle.record = domain.KindleSendRecord{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: started,
	}

	recorder := h.authed(http.MethodPost, "/api/kindle/send", nil)
	requireStatus(t, recorder, http.StatusAccepted)

	var queued itemResponse[kindleSendRecordJSON]
	decodeBody(t, recorder, &queued)
	if queued.Item == nil {
		t.Fatal("send response has no item")
	}

	if queued.Item.Status != domain.KindleStatusRunning || queued.Item.Trigger != domain.KindleTriggerManual {
		t.Fatalf("queued record = %+v", queued.Item)
	}

	if queued.Item.StartedAt != "2026-03-01T07:00:00Z" {
		t.Fatalf("startedAt = %q", queued.Item.StartedAt)
	}

	if h.kindle.calls != 1 {
		t.Fatalf("enqueue calls = %d", h.kindle.calls)
	}

	h.kindle.err = domain.NewError(domain.ErrKindleSendInProgress, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusConflict, "KindleSendInProgress")

	h.kindle.err = domain.NewError(domain.ErrKindleNotConfigured, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusUnprocessableEntity, "KindleNotConfigured")
}

func TestKindleSendsList(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	ctx := context.Background()
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	finished := started.Add(3 * time.Minute)
	if _, err := h.db.WriteDB().ExecContext(
		ctx,
		`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, error, started_at, finished_at) VALUES (?, 'scheduled', 'failed', 5, 2, 'smtp rejected the message', ?, ?)`,
		domain.NewID(),
		started.UnixMilli(),
		finished.UnixMilli(),
	); err != nil {
		t.Fatalf("insert failed kindle send: %v", err)
	}

	recorder := h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload kindleSendsResponse
	decodeBody(t, recorder, &payload)
	if payload.Running {
		t.Fatal("no send is running")
	}

	if len(payload.Items) != 1 {
		t.Fatalf("sends = %+v", payload.Items)
	}

	record := payload.Items[0]
	if record.Status != domain.KindleStatusFailed || record.ArticleCount != 5 || record.BookCount != 2 {
		t.Fatalf("record = %+v", record)
	}

	if record.Error == nil || *record.Error != "smtp rejected the message" {
		t.Fatalf("record error = %v", record.Error)
	}

	if record.StartedAt != "2026-03-01T07:00:00Z" || record.FinishedAt == nil || *record.FinishedAt != "2026-03-01T07:03:00Z" {
		t.Fatalf("record timestamps = %q / %v", record.StartedAt, record.FinishedAt)
	}

	if _, err := h.db.WriteDB().ExecContext(
		ctx,
		`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, started_at) VALUES (?, 'manual', 'running', 0, 0, ?)`,
		domain.NewID(),
		started.Add(time.Minute).UnixMilli(),
	); err != nil {
		t.Fatalf("insert running kindle send: %v", err)
	}

	recorder = h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &payload)
	if !payload.Running {
		t.Fatal("a running record must report running = true")
	}
}

func TestKindleEndpointsRequireDispatcher(t *testing.T) {
	t.Parallel()

	h := newHarnessWith(t, func(cfg *Config) { cfg.Kindle = nil })

	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusInternalServerError, "RequestFailed")

	recorder := h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload kindleSendsResponse
	decodeBody(t, recorder, &payload)
	if payload.Running || payload.Items == nil || len(payload.Items) != 0 {
		t.Fatalf("sends payload = %+v", payload)
	}

	if !strings.Contains(recorder.Body.String(), `"items":[]`) {
		t.Fatalf("empty sends must serialize as []: %s", recorder.Body.String())
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

	if cache := recorder.Header().Get("Cache-Control"); cache != indexCacheControl {
		t.Fatalf("index cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/later/0190f1f4-0000-7000-8000-000000000000", nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), "spa-shell") {
		t.Fatalf("spa fallback body = %s", recorder.Body.String())
	}

	recorder = h.raw(http.MethodHead, "/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	recorder = h.raw(http.MethodGet, "/assets/app-123.js", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "console.log('app')" {
		t.Fatalf("asset body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != immutableCacheControl {
		t.Fatalf("asset cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/favicon.ico", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "icon-bytes" {
		t.Fatalf("favicon body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != indexCacheControl {
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
}

func TestStaticServingWithoutEmbeddedFS(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	requireStatus(t, h.raw(http.MethodGet, "/", nil), http.StatusNotFound)
	requireStatus(t, h.raw(http.MethodGet, "/later", nil), http.StatusNotFound)
}

func TestListEndpointsHonorOrder(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	firstItem := h.seedItem(feed.ID, "https://example.com/a", nil)
	secondItem := h.seedItem(feed.ID, "https://example.com/b", nil)
	thirdItem := h.seedItem(feed.ID, "https://example.com/c", nil)
	firstPage := h.seedSavedPage("https://example.com/1", false)
	secondPage := h.seedSavedPage("https://example.com/2", false)

	for _, target := range []string{"/api/feed-items", "/api/folders/" + folder.ID + "/items"} {
		var page pageResponse[feedItemJSON]
		recorder := h.authed(http.MethodGet, target+"?order=oldest&limit=2", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 2 || page.Items[0].ID != firstItem.ID || page.Items[1].ID != secondItem.ID {
			t.Fatalf("%s oldest page = %+v", target, page.Items)
		}

		if page.Cursor == nil || *page.Cursor != secondItem.ID {
			t.Fatalf("%s oldest cursor = %v", target, page.Cursor)
		}

		recorder = h.authed(http.MethodGet, target+"?order=oldest&limit=2&cursor="+*page.Cursor, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 1 || page.Items[0].ID != thirdItem.ID || page.Cursor != nil {
			t.Fatalf("%s oldest continuation = %+v", target, page)
		}

		recorder = h.authed(http.MethodGet, target+"?order=newest", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s explicit newest = %+v", target, page.Items)
		}

		recorder = h.authed(http.MethodGet, target, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s default order = %+v", target, page.Items)
		}

		requireAPIError(t, h.authed(http.MethodGet, target+"?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
	}

	var saved pageResponse[savedPageJSON]
	recorder := h.authed(http.MethodGet, "/api/saved-pages?order=oldest", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &saved)
	if len(saved.Items) != 2 || saved.Items[0].ID != firstPage.ID || saved.Items[1].ID != secondPage.ID {
		t.Fatalf("saved pages oldest = %+v", saved.Items)
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
}
