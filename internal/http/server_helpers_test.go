package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
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

func (r *failingSavedPageRepo) UnreadCount(ctx context.Context, boundary string) (int, error) {
	if r.unreadErr != nil {
		return 0, r.unreadErr
	}

	return r.SavedPageRepository.UnreadCount(ctx, boundary)
}

func (r *failingSavedPageRepo) GetIDByURL(ctx context.Context, target domain.NormalizedURL) (string, bool, error) {
	if r.bypassGetByID {
		return "", false, nil
	}

	return r.SavedPageRepository.GetIDByURL(ctx, target)
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

	if err := h.db.Feeds().ApplySync(ctx, feedID, domain.FeedSyncMeta{Title: feed.Title}, h.clock.Now(), h.clock.Now(), []domain.FeedItem{item}, nil); err != nil {
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

func (h *harness) allSavedPages() []domain.SavedPage {
	h.t.Helper()

	res, err := h.db.SavedPages().List(context.Background(), domain.PageParams{Limit: 200, Boundary: domain.NewID()})
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

func requireSPASecurityHeaders(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	if got := recorder.Header().Get("Content-Security-Policy"); got != indexCSP {
		t.Fatalf("Content-Security-Policy = %q, want %q", got, indexCSP)
	}

	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
}
