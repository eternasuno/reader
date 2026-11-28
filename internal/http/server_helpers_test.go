package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reader/internal/domain"
	"reader/internal/sqlite"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

const (
	testAppURL        = "https://reader.example.com"
	testPassword      = "correct horse battery staple"
	testSessionSecret = "0123456789abcdef0123456789abcdef"

	testRefreshInterval = 30 * time.Minute
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

// failingSavedPageRepo wraps a real repository for deliberate error injection.

type failingSavedPageRepo struct {
	domain.SavedPageRepository
	snapshotErr error
	batchErr    error
	createErr   error
	unreadErr   error
}

func (r *failingSavedPageRepo) Snapshot(ctx context.Context, params domain.SnapshotParams) ([]string, error) {
	if r.snapshotErr != nil {
		return nil, r.snapshotErr
	}

	return r.SavedPageRepository.Snapshot(ctx, params)
}

func (r *failingSavedPageRepo) GetByIDs(ctx context.Context, ids []string) ([]domain.SavedPage, error) {
	if r.batchErr != nil {
		return nil, r.batchErr
	}

	return r.SavedPageRepository.GetByIDs(ctx, ids)
}

func (r *failingSavedPageRepo) Create(ctx context.Context, page domain.SavedPage) (domain.SavedPage, error) {
	if r.createErr != nil {
		return domain.SavedPage{}, r.createErr
	}

	return r.SavedPageRepository.Create(ctx, page)
}

func (r *failingSavedPageRepo) UnreadCount(ctx context.Context, boundary string) (int, error) {
	if r.unreadErr != nil {
		return 0, r.unreadErr
	}

	return r.SavedPageRepository.UnreadCount(ctx, boundary)
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

// beforeExtract models the fetch phase (blocking, cancellation) that precedes the article result.
type fakeWebpageExtractor struct {
	mu            sync.Mutex
	article       domain.ExtractedArticle
	err           error
	calls         int
	lastURL       string
	beforeExtract func(ctx context.Context, target domain.NormalizedURL) error
}

func (f *fakeWebpageExtractor) ExtractWebpage(ctx context.Context, target domain.NormalizedURL) (domain.ExtractedArticle, error) {
	f.mu.Lock()
	f.calls++
	f.lastURL = target.Raw()
	beforeExtract := f.beforeExtract
	article := f.article
	err := f.err
	f.mu.Unlock()

	if beforeExtract != nil {
		if hookErr := beforeExtract(ctx, target); hookErr != nil {
			return domain.ExtractedArticle{}, hookErr
		}
	}

	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	return article, nil
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

type fakeRefresher struct {
	mu    sync.Mutex
	wakes int
}

func (f *fakeRefresher) Wake() {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.wakes++
}

func (f *fakeRefresher) wakeCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()

	return f.wakes
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

	kindle      *fakeKindleDispatcher
	feedFetcher *fakeFeedFetcher
	feedParser  *fakeFeedParser
	extractor   *fakeWebpageExtractor

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
		t:           t,
		db:          db,
		clock:       &testClock{current: time.Date(2026, time.March, 1, 8, 0, 0, 0, time.UTC)},
		refresher:   &fakeRefresher{},
		kindle:      &fakeKindleDispatcher{},
		feedFetcher: &fakeFeedFetcher{},
		feedParser:  &fakeFeedParser{},
		extractor:   &fakeWebpageExtractor{},
	}

	cfg := Config{
		AppPassword:   testPassword,
		AppURL:        testAppURL,
		SessionSecret: []byte(testSessionSecret),
		Now:           h.clock.Now,
		HealthCheck:   func(ctx context.Context) error { return db.ReadDB().PingContext(ctx) },
		StaticFS:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html><html></html>")}},

		Folders:     db.Folders(),
		Feeds:       db.Feeds(),
		FeedItems:   db.FeedItems(),
		SavedPages:  db.SavedPages(),
		Settings:    db.Settings(),
		KindleSends: db.KindleSends(),

		FeedFetcher:      h.feedFetcher,
		FeedParser:       h.feedParser,
		WebpageExtractor: h.extractor,

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
	}, h.clock.Now())
	if err != nil {
		h.t.Fatalf("seed feed %q: %v", rawURL, err)
	}

	return created
}

// claimDueFeed claims the next feed due at the harness clock the way a refresh
// worker does, and returns nil when no feed is due.
func (h *harness) claimDueFeed() *domain.Feed {
	h.t.Helper()

	claimed, err := h.db.Feeds().ClaimDueRefresh(context.Background(), domain.NewID(), h.clock.Now())
	if err != nil {
		h.t.Fatalf("claim due refresh: %v", err)
	}

	return claimed
}

// succeedRefresh runs one successful refresh attempt for the feed that finishes
// at finishedAt and makes the feed due again testRefreshInterval later.
func (h *harness) succeedRefresh(feedID string, meta domain.FeedSyncMeta, finishedAt time.Time) {
	h.t.Helper()

	ctx := context.Background()
	attemptID := domain.NewID()

	_, err := h.db.WriteDB().ExecContext(
		ctx,
		`INSERT INTO feed_refresh (id, feed_id, status, started_at) VALUES (?, ?, 'running', ?)`,
		attemptID,
		feedID,
		finishedAt.Add(-time.Second).UnixMilli(),
	)
	if err != nil {
		h.t.Fatalf("start refresh of feed %s: %v", feedID, err)
	}

	err = h.db.Feeds().SucceedRefresh(ctx, attemptID, feedID, meta, nil, finishedAt, finishedAt.Add(testRefreshInterval))
	if err != nil {
		h.t.Fatalf("succeed refresh of feed %s: %v", feedID, err)
	}
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

	var publishedAt *int64
	if item.PublishedAt != nil {
		millis := item.PublishedAt.UnixMilli()
		publishedAt = &millis
	}

	_, err = h.db.WriteDB().ExecContext(context.Background(), `
		INSERT INTO feed_item (id, feed_id, url, title, description, content, extracted_content, published_at, read)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.FeedID, item.URL.Raw(), item.Title, item.Description, item.Content, item.ExtractedContent, publishedAt, item.Read,
	)
	if err != nil {
		h.t.Fatalf("seed item %q: %v", rawURL, err)
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

	folders, err := h.db.Folders().List(context.Background())
	if err != nil {
		h.t.Fatalf("folderByID %s: %v", id, err)
	}

	for i := range folders {
		if folders[i].ID == id {
			return &folders[i]
		}
	}

	return nil
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

func (h *harness) allSavedPageIDs() []string {
	h.t.Helper()

	ids, err := h.db.SavedPages().Snapshot(context.Background(), domain.NewSnapshotParams(false, ""))
	if err != nil {
		h.t.Fatalf("snapshot saved pages: %v", err)
	}

	return ids
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

func requireSPASecurityHeaders(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	want := map[string]string{
		"default-src":     "'self'",
		"script-src":      "'self'",
		"style-src":       "'self' 'unsafe-inline'",
		"img-src":         "'self' https: http: data:",
		"media-src":       "https: http:",
		"frame-src":       "https: http:",
		"connect-src":     "'self'",
		"object-src":      "'none'",
		"base-uri":        "'none'",
		"form-action":     "'self'",
		"frame-ancestors": "'none'",
	}

	got := map[string]string{}
	for _, directive := range strings.Split(recorder.Header().Get("Content-Security-Policy"), ";") {
		name, sources, _ := strings.Cut(strings.TrimSpace(directive), " ")
		got[name] = sources
	}

	if !maps.Equal(got, want) {
		t.Fatalf("Content-Security-Policy directives = %v, want %v", got, want)
	}

	if got := recorder.Header().Get("Referrer-Policy"); got != "same-origin" {
		t.Fatalf("Referrer-Policy = %q, want same-origin", got)
	}

	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
}
