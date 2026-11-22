package worker

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"reader/internal/domain"
)

const testWaitTimeout = 3 * time.Second

func ptrTo[T any](value T) *T {
	return &value
}

func testURL(t *testing.T, raw string) domain.NormalizedURL {
	t.Helper()

	normalized, err := domain.ParseNormalizedURL(raw, domain.ErrFeedUrlInvalid)
	if err != nil {
		t.Fatalf("ParseNormalizedURL(%q) error = %v", raw, err)
	}

	return normalized
}

func waitFor(t *testing.T, condition func() bool, message string) {
	t.Helper()

	deadline := time.Now().Add(testWaitTimeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}

		time.Sleep(2 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for %s", message)
}

func requireErrorCode(t *testing.T, err error, code domain.ErrorCode) {
	t.Helper()

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("error = %v, want domain error %s", err, code)
	}

	if domainErr.Code != code {
		t.Fatalf("error code = %s, want %s", domainErr.Code, code)
	}
}

type recordedFailure struct {
	feedID  string
	summary string
}

type appliedSync struct {
	feedID    string
	title     string
	updatedAt time.Time
	newItems  []domain.FeedItem
	deleteIDs []string
}

type fakeFeedRepository struct {
	mu       sync.Mutex
	feeds    map[string]domain.Feed
	list     []domain.Feed
	listErr  error
	getErr   error
	applyErr error

	listCalls    int
	getByIDCalls int
	failures     []recordedFailure
	syncs        []appliedSync
}

func newTestFeedRepository(feeds ...domain.Feed) *fakeFeedRepository {
	byID := make(map[string]domain.Feed, len(feeds))
	for _, feed := range feeds {
		byID[feed.ID] = feed
	}

	return &fakeFeedRepository{feeds: byID, list: feeds}
}

func (r *fakeFeedRepository) List(ctx context.Context) ([]domain.Feed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.listCalls++
	if r.listErr != nil {
		return nil, r.listErr
	}

	return append([]domain.Feed(nil), r.list...), nil
}

func (r *fakeFeedRepository) GetByID(ctx context.Context, id string) (*domain.Feed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.getByIDCalls++
	if r.getErr != nil {
		return nil, r.getErr
	}

	feed, ok := r.feeds[id]
	if !ok {
		return nil, nil
	}

	return &feed, nil
}

func (r *fakeFeedRepository) GetByURL(ctx context.Context, url domain.NormalizedURL) (*domain.Feed, error) {
	return nil, nil
}

func (r *fakeFeedRepository) Create(ctx context.Context, feed domain.Feed) (domain.Feed, error) {
	return feed, nil
}

func (r *fakeFeedRepository) Delete(ctx context.Context, id string) error {
	return nil
}

func (r *fakeFeedRepository) UpdateReaderMode(ctx context.Context, id string, mode domain.ReaderMode) error {
	return nil
}

func (r *fakeFeedRepository) UpdateOrder(ctx context.Context, id string, order domain.SortOrder) error {
	return nil
}

func (r *fakeFeedRepository) MoveToFolder(ctx context.Context, id string, folderID *string) error {
	return nil
}

func (r *fakeFeedRepository) RecordRefreshFailure(ctx context.Context, id string, errSummary string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.failures = append(r.failures, recordedFailure{feedID: id, summary: errSummary})

	return nil
}

func (r *fakeFeedRepository) ApplySync(ctx context.Context, feedID string, newTitle string, updatedAt time.Time, newItems []domain.FeedItem, deleteIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.applyErr != nil {
		return r.applyErr
	}

	r.syncs = append(r.syncs, appliedSync{
		feedID:    feedID,
		title:     newTitle,
		updatedAt: updatedAt,
		newItems:  append([]domain.FeedItem(nil), newItems...),
		deleteIDs: append([]string(nil), deleteIDs...),
	})

	return nil
}

func (r *fakeFeedRepository) ImportOPML(ctx context.Context, doc domain.OPMLDocument) (domain.OPMLImportResult, []string, error) {
	return domain.OPMLImportResult{}, nil, nil
}

func (r *fakeFeedRepository) failureList() []recordedFailure {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]recordedFailure(nil), r.failures...)
}

func (r *fakeFeedRepository) syncList() []appliedSync {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]appliedSync(nil), r.syncs...)
}

type savedExtraction struct {
	id      string
	content string
}

type fakeFeedItemRepository struct {
	mu      sync.Mutex
	stored  []domain.FeedItem
	listErr error
	saveErr error
	saved   []savedExtraction
}

func (r *fakeFeedItemRepository) ListAll(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return domain.PageResult[domain.FeedItem]{}, nil
}

func (r *fakeFeedItemRepository) ListByFeed(ctx context.Context, feedID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return domain.PageResult[domain.FeedItem]{}, nil
}

func (r *fakeFeedItemRepository) ListByFolder(ctx context.Context, folderID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return domain.PageResult[domain.FeedItem]{}, nil
}

func (r *fakeFeedItemRepository) ListByFeedForRetention(ctx context.Context, feedID string) ([]domain.FeedItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.listErr != nil {
		return nil, r.listErr
	}

	return append([]domain.FeedItem(nil), r.stored...), nil
}

func (r *fakeFeedItemRepository) GetByID(ctx context.Context, id string) (*domain.FeedItem, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) UnreadCounts(ctx context.Context) ([]domain.FeedUnreadCount, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) SetRead(ctx context.Context, id string, read bool) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkIDsRead(ctx context.Context, ids []string) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkAllRead(ctx context.Context) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkFeedRead(ctx context.Context, feedID string) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkFolderRead(ctx context.Context, folderID string) error {
	return nil
}

func (r *fakeFeedItemRepository) SaveExtractedContent(ctx context.Context, id string, content string) (*domain.FeedItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.saved = append(r.saved, savedExtraction{id: id, content: content})

	if r.saveErr != nil {
		return nil, r.saveErr
	}

	return nil, nil
}

func (r *fakeFeedItemRepository) savedList() []savedExtraction {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]savedExtraction(nil), r.saved...)
}

type fakeSettingRepository struct {
	mu         sync.Mutex
	settings   domain.Settings
	getErr     error
	advanceErr error
	keepDue    bool
	gets       int
	advances   []time.Time
}

func (r *fakeSettingRepository) Get(ctx context.Context) (domain.Settings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.gets++
	if r.getErr != nil {
		return domain.Settings{}, r.getErr
	}

	return r.settings, nil
}

func (r *fakeSettingRepository) UpdateRetention(ctx context.Context, retention int) error {
	return nil
}

func (r *fakeSettingRepository) UpdateProvider(ctx context.Context, provider domain.ExtractorProvider) error {
	return nil
}

func (r *fakeSettingRepository) UpdateJinaKey(ctx context.Context, key string) error {
	return nil
}

func (r *fakeSettingRepository) DeleteJinaKey(ctx context.Context) error {
	return nil
}

func (r *fakeSettingRepository) UpdateBrowserEndpoint(ctx context.Context, endpoint string) error {
	return nil
}

func (r *fakeSettingRepository) DeleteBrowserEndpoint(ctx context.Context) error {
	return nil
}

func (r *fakeSettingRepository) UpdateSMTP(ctx context.Context, smtp domain.SMTPSettings) error {
	return nil
}

func (r *fakeSettingRepository) DeleteSMTPPassword(ctx context.Context) error {
	return nil
}

func (r *fakeSettingRepository) DeleteSMTP(ctx context.Context) error {
	return nil
}

func (r *fakeSettingRepository) UpdateKindle(ctx context.Context, kindle domain.KindleSettings) error {
	return nil
}

func (r *fakeSettingRepository) AdvanceNextSendAt(ctx context.Context, nextSendAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.advances = append(r.advances, nextSendAt)

	if r.advanceErr != nil {
		return r.advanceErr
	}

	if r.keepDue || r.settings.Kindle == nil {
		return nil
	}

	next := nextSendAt
	r.settings.Kindle.NextSendAt = &next

	return nil
}

func (r *fakeSettingRepository) advanceList() []time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]time.Time(nil), r.advances...)
}

type fakeFeedFetcher struct {
	mu       sync.Mutex
	calls    []string
	fetch    func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error)
	body     []byte
	finalURL string
	err      error
}

func (f *fakeFeedFetcher) FetchFeed(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
	f.mu.Lock()
	f.calls = append(f.calls, url.Raw())
	hook := f.fetch
	f.mu.Unlock()

	if hook != nil {
		return hook(ctx, url)
	}

	return f.body, f.finalURL, f.err
}

func (f *fakeFeedFetcher) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()

	return len(f.calls)
}

type fakeFeedParser struct {
	mu     sync.Mutex
	parsed domain.ParsedFeed
	err    error
	calls  int
}

func (p *fakeFeedParser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.calls++

	return p.parsed, p.err
}

type acceptedBook struct {
	sendID       string
	savedPageIDs []string
	feedItemIDs  []string
	articleDelta int
}

type completedSend struct {
	sendID     string
	status     domain.KindleStatus
	errSummary *string
	finishedAt time.Time
}

type fakeKindleSendRepository struct {
	mu              sync.Mutex
	savedPages      []domain.SavedPage
	feeds           []domain.Feed
	items           map[string][]domain.FeedItem
	listErr         error
	createErr       error
	recordErr       error
	completeErr     error
	completeFailure int

	listCalls     int
	completeCalls int
	created       []domain.KindleSendRecord
	accepted      []acceptedBook
	completed     []completedSend
}

func (r *fakeKindleSendRepository) RecoverRunningOnStartup(ctx context.Context, now time.Time) error {
	return nil
}

func (r *fakeKindleSendRepository) ListRecent(ctx context.Context) ([]domain.KindleSendRecord, error) {
	return nil, nil
}

func (r *fakeKindleSendRepository) CreateRunning(ctx context.Context, record domain.KindleSendRecord) (domain.KindleSendRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.createErr != nil {
		return domain.KindleSendRecord{}, r.createErr
	}

	r.created = append(r.created, record)

	return record, nil
}

func (r *fakeKindleSendRepository) ListUnreadForKindle(ctx context.Context) ([]domain.SavedPage, []domain.Feed, map[string][]domain.FeedItem, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.listCalls++
	if r.listErr != nil {
		return nil, nil, nil, r.listErr
	}

	items := make(map[string][]domain.FeedItem, len(r.items))
	for feedID, feedItems := range r.items {
		items[feedID] = append([]domain.FeedItem(nil), feedItems...)
	}

	return append([]domain.SavedPage(nil), r.savedPages...), append([]domain.Feed(nil), r.feeds...), items, nil
}

func (r *fakeKindleSendRepository) RecordBookAccepted(ctx context.Context, sendID string, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.recordErr != nil {
		return r.recordErr
	}

	r.accepted = append(r.accepted, acceptedBook{
		sendID:       sendID,
		savedPageIDs: append([]string(nil), savedPageIDs...),
		feedItemIDs:  append([]string(nil), feedItemIDs...),
		articleDelta: articleDelta,
	})

	return nil
}

func (r *fakeKindleSendRepository) CompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.completed = append(r.completed, completedSend{
		sendID:     sendID,
		status:     status,
		errSummary: errSummary,
		finishedAt: finishedAt,
	})

	r.completeCalls++

	if r.completeFailure > 0 {
		r.completeFailure--

		return errors.New("transient complete failure")
	}

	return r.completeErr
}

func (r *fakeKindleSendRepository) createdList() []domain.KindleSendRecord {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]domain.KindleSendRecord(nil), r.created...)
}

func (r *fakeKindleSendRepository) acceptedList() []acceptedBook {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]acceptedBook(nil), r.accepted...)
}

func (r *fakeKindleSendRepository) completedList() []completedSend {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]completedSend(nil), r.completed...)
}

func (r *fakeKindleSendRepository) completeCallsList() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.completeCalls
}

type fakeWebpageFetcher struct {
	mu    sync.Mutex
	calls []string
	fetch func(ctx context.Context, url domain.NormalizedURL) (string, string, error)
}

func (f *fakeWebpageFetcher) FetchWebpage(ctx context.Context, url domain.NormalizedURL) (string, string, error) {
	f.mu.Lock()
	f.calls = append(f.calls, url.Raw())
	hook := f.fetch
	f.mu.Unlock()

	if hook == nil {
		return "", "", errors.New("unexpected webpage fetch")
	}

	return hook(ctx, url)
}

func (f *fakeWebpageFetcher) callList() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	return append([]string(nil), f.calls...)
}

type fakeArticleExtractor struct {
	mu      sync.Mutex
	calls   int
	extract func(ctx context.Context, htmlBody string, pageURL string) (domain.ExtractedArticle, error)
}

func (e *fakeArticleExtractor) ExtractArticle(htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
	e.mu.Lock()
	e.calls++
	hook := e.extract
	e.mu.Unlock()

	if hook == nil {
		return domain.ExtractedArticle{Content: htmlBody}, nil
	}

	return hook(context.Background(), htmlBody, pageURL)
}

type buildCall struct {
	dateStr  string
	articles []domain.KindleArticle
}

type fakeEPUBBuilder struct {
	mu       sync.Mutex
	build    func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error)
	calls    int
	lastCall buildCall
}

func (b *fakeEPUBBuilder) BuildBooks(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
	b.mu.Lock()
	b.calls++
	b.lastCall = buildCall{dateStr: dateStr, articles: append([]domain.KindleArticle(nil), articles...)}
	hook := b.build
	b.mu.Unlock()

	if hook == nil {
		return nil, nil
	}

	return hook(ctx, dateStr, articles)
}

func (b *fakeEPUBBuilder) callCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.calls
}

func (b *fakeEPUBBuilder) captured() buildCall {
	b.mu.Lock()
	defer b.mu.Unlock()

	return buildCall{dateStr: b.lastCall.dateStr, articles: append([]domain.KindleArticle(nil), b.lastCall.articles...)}
}

type sentMail struct {
	delivery domain.KindleDelivery
	book     domain.EPUBBook
}

type fakeMailSender struct {
	mu   sync.Mutex
	send func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error
	sent []sentMail
}

func (m *fakeMailSender) SendEPUB(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
	m.mu.Lock()
	m.sent = append(m.sent, sentMail{delivery: delivery, book: book})
	hook := m.send
	m.mu.Unlock()

	if hook == nil {
		return nil
	}

	return hook(ctx, delivery, book)
}

func (m *fakeMailSender) sentList() []sentMail {
	m.mu.Lock()
	defer m.mu.Unlock()

	return append([]sentMail(nil), m.sent...)
}

func parsedEntry(t *testing.T, raw string, title string) domain.ParsedFeedEntry {
	t.Helper()

	return domain.ParsedFeedEntry{URL: testURL(t, raw), Title: title}
}

func configuredSMTPSettings() domain.SMTPSettings {
	return domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptrTo("smtp-user"),
		Password:    ptrTo("smtp-password"),
	}
}

func configuredKindleSettings() domain.KindleSettings {
	return domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
	}
}

func configuredDeliverySettings() domain.Settings {
	smtp := configuredSMTPSettings()
	kindle := configuredKindleSettings()

	return domain.Settings{
		SMTP:   &smtp,
		Kindle: &kindle,
	}
}

func TestNewRefreshQueueAppliesDefaults(t *testing.T) {
	t.Parallel()

	queue := NewRefreshQueue(RefreshConfig{})

	if queue.concurrency != defaultRefreshConcurrency {
		t.Fatalf("concurrency = %d, want %d", queue.concurrency, defaultRefreshConcurrency)
	}

	if queue.interval != defaultRefreshInterval {
		t.Fatalf("interval = %v, want %v", queue.interval, defaultRefreshInterval)
	}

	if queue.now == nil {
		t.Fatal("now = nil, want time.Now default")
	}
}

func TestRefreshOneSyncsFeed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feed := domain.Feed{
		ID:         "feed-1",
		URL:        testURL(t, "https://example.com/feed.xml"),
		Title:      "Old Title",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}

	feeds := newTestFeedRepository(feed)
	settings := &fakeSettingRepository{settings: domain.Settings{Retention: 1}}
	fetcher := &fakeFeedFetcher{body: []byte("<rss>"), finalURL: "https://example.com/feed.xml"}
	parser := &fakeFeedParser{parsed: domain.ParsedFeed{
		Title: "Fresh Title",
		Entries: []domain.ParsedFeedEntry{
			parsedEntry(t, "https://example.com/one", "One"),
			parsedEntry(t, "https://example.com/two", "Two"),
		},
	}}
	items := &fakeFeedItemRepository{}

	queue := NewRefreshQueue(RefreshConfig{
		Feeds:     feeds,
		FeedItems: items,
		Settings:  settings,
		Fetcher:   fetcher,
		Parser:    parser,
		Now:       func() time.Time { return now },
	})

	if err := queue.RefreshOne(context.Background(), "feed-1"); err != nil {
		t.Fatalf("RefreshOne() error = %v", err)
	}

	if len(fetcher.calls) != 1 || fetcher.calls[0] != feed.URL.Raw() {
		t.Fatalf("fetched URLs = %v, want [%s]", fetcher.calls, feed.URL.Raw())
	}

	syncs := feeds.syncList()
	if len(syncs) != 1 {
		t.Fatalf("ApplySync calls = %d, want 1", len(syncs))
	}

	applied := syncs[0]
	if applied.feedID != "feed-1" {
		t.Fatalf("feedID = %q, want %q", applied.feedID, "feed-1")
	}

	if applied.title != "Fresh Title" {
		t.Fatalf("title = %q, want %q", applied.title, "Fresh Title")
	}

	if !applied.updatedAt.Equal(now) {
		t.Fatalf("updatedAt = %v, want %v", applied.updatedAt, now)
	}

	if len(applied.newItems) != 1 {
		t.Fatalf("newItems = %d, want 1 (retention honoured)", len(applied.newItems))
	}

	if applied.newItems[0].URL.Raw() != "https://example.com/one" {
		t.Fatalf("newItems[0].URL = %q, want https://example.com/one", applied.newItems[0].URL.Raw())
	}

	if applied.newItems[0].ID == "" {
		t.Fatal("newItems[0].ID = empty, want generated id")
	}

	if len(applied.deleteIDs) != 0 {
		t.Fatalf("deleteIDs = %v, want none", applied.deleteIDs)
	}

	if failures := feeds.failureList(); len(failures) != 0 {
		t.Fatalf("recorded failures = %v, want none", failures)
	}
}

func TestRefreshOneRetentionFallbacks(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		settings *fakeSettingRepository
		want     int
	}{
		{
			name:     "configured retention",
			settings: &fakeSettingRepository{settings: domain.Settings{Retention: 1}},
			want:     1,
		},
		{
			name:     "zero retention falls back to default",
			settings: &fakeSettingRepository{settings: domain.Settings{Retention: 0}},
			want:     2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
			feeds := newTestFeedRepository(feed)
			parser := &fakeFeedParser{parsed: domain.ParsedFeed{
				Entries: []domain.ParsedFeedEntry{
					parsedEntry(t, "https://example.com/one", "One"),
					parsedEntry(t, "https://example.com/two", "Two"),
				},
			}}

			queue := NewRefreshQueue(RefreshConfig{
				Feeds:     feeds,
				FeedItems: &fakeFeedItemRepository{},
				Settings:  tc.settings,
				Fetcher:   &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"},
				Parser:    parser,
				Now:       func() time.Time { return now },
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); err != nil {
				t.Fatalf("RefreshOne() error = %v", err)
			}

			syncs := feeds.syncList()
			if len(syncs) != 1 {
				t.Fatalf("ApplySync calls = %d, want 1", len(syncs))
			}

			if got := len(syncs[0].newItems); got != tc.want {
				t.Fatalf("newItems = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestRefreshOneFallsBackToFeedTitleAndHost(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		parsedTitle string
		feedTitle   string
		want        string
	}{
		{name: "parsed title wins", parsedTitle: "Parsed", feedTitle: "Stored", want: "Parsed"},
		{name: "stored feed title", parsedTitle: "   ", feedTitle: "Stored", want: "Stored"},
		{name: "url host", parsedTitle: "", feedTitle: "", want: "example.com"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml"), Title: tc.feedTitle}
			feeds := newTestFeedRepository(feed)

			queue := NewRefreshQueue(RefreshConfig{
				Feeds:     feeds,
				FeedItems: &fakeFeedItemRepository{},
				Settings:  &fakeSettingRepository{},
				Fetcher:   &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"},
				Parser:    &fakeFeedParser{parsed: domain.ParsedFeed{Title: tc.parsedTitle}},
				Now:       func() time.Time { return now },
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); err != nil {
				t.Fatalf("RefreshOne() error = %v", err)
			}

			syncs := feeds.syncList()
			if len(syncs) != 1 {
				t.Fatalf("ApplySync calls = %d, want 1", len(syncs))
			}

			if syncs[0].title != tc.want {
				t.Fatalf("title = %q, want %q", syncs[0].title, tc.want)
			}
		})
	}
}

func TestRefreshOneRecordsFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		settings *fakeSettingRepository
		setup    func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, fetcher *fakeFeedFetcher, parser *fakeFeedParser)
		summary  string
	}{
		{
			name:     "settings failure aborts before fetching",
			settings: &fakeSettingRepository{getErr: errors.New("settings unavailable")},
			summary:  "settings unavailable",
		},
		{
			name: "fetch failure is sanitized",
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				fetcher.err = errors.New("fetch failed for https://alice:secret@example.com/feed.xml")
			},
			summary: "fetch failed for https://example.com/feed.xml",
		},
		{
			name: "parse failure",
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				parser.err = errors.New("invalid feed")
			},
			summary: "invalid feed",
		},
		{
			name: "retention list failure",
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				items.listErr = errors.New("items unavailable")
			},
			summary: "items unavailable",
		},
		{
			name: "apply sync failure",
			setup: func(feeds *fakeFeedRepository, items *fakeFeedItemRepository, fetcher *fakeFeedFetcher, parser *fakeFeedParser) {
				feeds.applyErr = errors.New("write failed")
			},
			summary: "write failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")}
			feeds := newTestFeedRepository(feed)
			items := &fakeFeedItemRepository{}
			fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}
			parser := &fakeFeedParser{}
			if tc.setup != nil {
				tc.setup(feeds, items, fetcher, parser)
			}

			settings := tc.settings
			if settings == nil {
				settings = &fakeSettingRepository{}
			}

			queue := NewRefreshQueue(RefreshConfig{
				Feeds:     feeds,
				FeedItems: items,
				Settings:  settings,
				Fetcher:   fetcher,
				Parser:    parser,
				Now:       func() time.Time { return now },
			})

			if err := queue.RefreshOne(context.Background(), "feed-1"); err == nil {
				t.Fatal("RefreshOne() error = nil, want error")
			}

			failures := feeds.failureList()
			if len(failures) != 1 {
				t.Fatalf("recorded failures = %d, want 1", len(failures))
			}

			if failures[0].feedID != "feed-1" {
				t.Fatalf("failure feedID = %q, want feed-1", failures[0].feedID)
			}

			if failures[0].summary != tc.summary {
				t.Fatalf("failure summary = %q, want %q", failures[0].summary, tc.summary)
			}

			if strings.Contains(failures[0].summary, "alice:secret") {
				t.Fatalf("failure summary leaks credentials: %q", failures[0].summary)
			}

			if len(feeds.syncList()) != 0 {
				t.Fatal("ApplySync called after failure")
			}

			if tc.settings != nil && fetcher.callCount() != 0 {
				t.Fatalf("feed fetched %d times after a settings failure, want 0", fetcher.callCount())
			}
		})
	}
}

func TestRefreshOneMissingFeedIsNoOp(t *testing.T) {
	t.Parallel()

	feeds := newTestFeedRepository()
	queue := NewRefreshQueue(RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   &fakeFeedFetcher{},
		Parser:    &fakeFeedParser{},
	})

	if err := queue.RefreshOne(context.Background(), "missing"); err != nil {
		t.Fatalf("RefreshOne() error = %v, want nil", err)
	}

	if len(feeds.failureList()) != 0 {
		t.Fatal("RecordRefreshFailure called for a missing feed")
	}

	if len(feeds.syncList()) != 0 {
		t.Fatal("ApplySync called for a missing feed")
	}
}

func TestRefreshOneReturnsRepositoryError(t *testing.T) {
	t.Parallel()

	want := errors.New("database down")
	feeds := newTestFeedRepository()
	feeds.getErr = want

	queue := NewRefreshQueue(RefreshConfig{Feeds: feeds, Settings: &fakeSettingRepository{}})

	if err := queue.RefreshOne(context.Background(), "feed-1"); !errors.Is(err, want) {
		t.Fatalf("RefreshOne() error = %v, want %v", err, want)
	}
}

func TestEnqueueDeduplicatesPendingFeeds(t *testing.T) {
	t.Parallel()

	queue := NewRefreshQueue(RefreshConfig{})
	queue.Enqueue("a", "", "a", "b")
	queue.Enqueue("a", "b", "")

	queue.mu.Lock()
	pending := append([]string(nil), queue.queue...)
	queuedCount := len(queue.queued)
	queue.mu.Unlock()

	if !slices.Equal(pending, []string{"a", "b"}) {
		t.Fatalf("pending queue = %v, want [a b]", pending)
	}

	if queuedCount != 2 {
		t.Fatalf("queued set size = %d, want 2", queuedCount)
	}
}

func TestEnqueueAllReturnsListError(t *testing.T) {
	t.Parallel()

	want := errors.New("list failed")
	feeds := newTestFeedRepository()
	feeds.listErr = want

	queue := NewRefreshQueue(RefreshConfig{Feeds: feeds})

	if err := queue.EnqueueAll(context.Background()); !errors.Is(err, want) {
		t.Fatalf("EnqueueAll() error = %v, want %v", err, want)
	}
}

func TestStartRefreshesAllFeedsAtStartup(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feeds := newTestFeedRepository(
		domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/one.xml")},
		domain.Feed{ID: "feed-2", URL: testURL(t, "https://example.com/two.xml")},
	)
	fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}

	queue := NewRefreshQueue(RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   fetcher,
		Parser:    &fakeFeedParser{},
		Interval:  time.Hour,
		Now:       func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	waitFor(t, func() bool { return fetcher.callCount() >= 2 }, "startup refresh of all feeds")

	if syncs := feeds.syncList(); len(syncs) != 2 {
		t.Fatalf("ApplySync calls = %d, want 2", len(syncs))
	}
}

func TestStartRepeatsOnInterval(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feeds := newTestFeedRepository(domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")})
	fetcher := &fakeFeedFetcher{body: []byte("x"), finalURL: "https://example.com/feed.xml"}

	queue := NewRefreshQueue(RefreshConfig{
		Feeds:     feeds,
		FeedItems: &fakeFeedItemRepository{},
		Settings:  &fakeSettingRepository{},
		Fetcher:   fetcher,
		Parser:    &fakeFeedParser{},
		Interval:  20 * time.Millisecond,
		Now:       func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	waitFor(t, func() bool { return fetcher.callCount() >= 3 }, "interval refresh cycle")
}

func TestStartBoundsConcurrency(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feeds := make([]domain.Feed, 0, 6)
	for i := range 6 {
		id := string(rune('a' + i))
		feeds = append(feeds, domain.Feed{ID: id, URL: testURL(t, "https://example.com/"+id+".xml")})
	}

	release := make(chan struct{})
	entered := make(chan struct{}, len(feeds))

	var mu sync.Mutex
	active, maxActive := 0, 0

	fetcher := &fakeFeedFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()

		entered <- struct{}{}
		<-release

		mu.Lock()
		active--
		mu.Unlock()

		return []byte("x"), "https://example.com/feed", nil
	}

	queue := NewRefreshQueue(RefreshConfig{
		Feeds:       newTestFeedRepository(feeds...),
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{},
		Fetcher:     fetcher,
		Parser:      &fakeFeedParser{},
		Concurrency: 2,
		Interval:    time.Hour,
		Now:         func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	for range 2 {
		select {
		case <-entered:
		case <-time.After(testWaitTimeout):
			t.Fatal("timed out waiting for concurrent workers")
		}
	}

	mu.Lock()
	gotMax := maxActive
	mu.Unlock()

	if gotMax != 2 {
		t.Fatalf("max concurrent refreshes = %d, want 2", gotMax)
	}

	close(release)

	waitFor(t, func() bool { return fetcher.callCount() >= len(feeds) }, "all feeds refreshed")

	mu.Lock()
	defer mu.Unlock()

	if maxActive > 2 {
		t.Fatalf("max concurrent refreshes = %d, want <= 2", maxActive)
	}
}

func TestEnqueueDropsRunningFeed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feeds := newTestFeedRepository(domain.Feed{ID: "feed-1", URL: testURL(t, "https://example.com/feed.xml")})

	release := make(chan struct{})
	started := make(chan struct{}, 1)

	fetcher := &fakeFeedFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
		started <- struct{}{}
		<-release

		return []byte("x"), "https://example.com/feed.xml", nil
	}

	queue := NewRefreshQueue(RefreshConfig{
		Feeds:       feeds,
		FeedItems:   &fakeFeedItemRepository{},
		Settings:    &fakeSettingRepository{},
		Fetcher:     fetcher,
		Parser:      &fakeFeedParser{},
		Concurrency: 1,
		Interval:    time.Hour,
		Now:         func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	queue.Start(ctx)

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for first refresh to start")
	}

	queue.Enqueue("feed-1")

	close(release)

	waitFor(t, func() bool { return fetcher.callCount() == 1 }, "duplicate enqueue dropped")
	time.Sleep(20 * time.Millisecond)

	if got := fetcher.callCount(); got != 1 {
		t.Fatalf("fetch calls while running = %d, want 1", got)
	}

	queue.Enqueue("feed-1")

	waitFor(t, func() bool { return fetcher.callCount() == 2 }, "re-enqueue after completion")
}

func TestNewKindleSenderAppliesDefaults(t *testing.T) {
	t.Parallel()

	sender := NewKindleSender(KindleConfig{})

	if sender.baseCtx == nil {
		t.Fatal("baseCtx = nil, want background context")
	}

	if sender.loc != time.Local {
		t.Fatalf("loc = %v, want time.Local", sender.loc)
	}

	if sender.tickInterval != defaultKindleTickInterval {
		t.Fatalf("tickInterval = %v, want %v", sender.tickInterval, defaultKindleTickInterval)
	}

	if sender.now == nil {
		t.Fatal("now = nil, want time.Now default")
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true, want false")
	}

	sender.Wait()
}

func TestEnqueueManualRejectsUnconfiguredKindle(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		configure func(settings *domain.Settings)
	}{
		{
			name: "missing smtp and kindle settings",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
				settings.Kindle = nil
			},
		},
		{
			name: "smtp configured but kindle nil",
			configure: func(settings *domain.Settings) {
				settings.Kindle = nil
			},
		},
		{
			name: "kindle configured but smtp nil",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
			},
		},
		{
			name: "blank kindle email",
			configure: func(settings *domain.Settings) {
				settings.Kindle.KindleEmail = "   "
			},
		},
		{
			name: "blank smtp host",
			configure: func(settings *domain.Settings) {
				settings.SMTP.Host = "   "
			},
		},
		{
			name: "blank sender email",
			configure: func(settings *domain.Settings) {
				settings.SMTP.SenderEmail = ""
			},
		},
		{
			name: "port out of range",
			configure: func(settings *domain.Settings) {
				settings.SMTP.Port = 70000
			},
		},
		{
			name: "zero port",
			configure: func(settings *domain.Settings) {
				settings.SMTP.Port = 0
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			settings := configuredDeliverySettings()
			tc.configure(&settings)

			sender := NewKindleSender(KindleConfig{
				Settings:    &fakeSettingRepository{settings: settings},
				KindleSends: &fakeKindleSendRepository{},
				EPUBBuilder: &fakeEPUBBuilder{},
				MailSender:  &fakeMailSender{},
			})

			_, err := sender.EnqueueManual(context.Background())
			requireErrorCode(t, err, domain.ErrKindleNotConfigured)

			if sender.IsRunning() {
				t.Fatal("IsRunning() = true after rejected enqueue")
			}
		})
	}
}

func TestEnqueueManualReturnsSettingsError(t *testing.T) {
	t.Parallel()

	want := errors.New("settings unavailable")
	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{getErr: want},
		KindleSends: &fakeKindleSendRepository{},
	})

	if _, err := sender.EnqueueManual(context.Background()); !errors.Is(err, want) {
		t.Fatalf("EnqueueManual() error = %v, want %v", err, want)
	}
}

func TestEnqueueManualReturnsCreateError(t *testing.T) {
	t.Parallel()

	want := errors.New("create failed")
	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: &fakeKindleSendRepository{createErr: want},
	})

	if _, err := sender.EnqueueManual(context.Background()); !errors.Is(err, want) {
		t.Fatalf("EnqueueManual() error = %v, want %v", err, want)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after CreateRunning failure")
	}
}

func TestEnqueueManualRunsJob(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 17, 0, 0, 0, time.UTC)
	loc := time.FixedZone("CST", 8*60*60)
	publishedAt := time.Date(2026, 3, 13, 9, 30, 0, 0, time.UTC)

	deliverySettings := configuredDeliverySettings()
	deliverySettings.Retention = 100
	settings := &fakeSettingRepository{settings: deliverySettings}

	page := domain.SavedPage{
		ID:          "page-1",
		URL:         testURL(t, "https://example.com/page"),
		Title:       "Saved Page",
		Content:     "<p>saved</p>",
		PublishedAt: &publishedAt,
	}
	feed := domain.Feed{
		ID:         "feed-1",
		URL:        testURL(t, "https://example.com/feed.xml"),
		Title:      "Example Feed",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}
	item := domain.FeedItem{
		ID:          "item-1",
		FeedID:      "feed-1",
		URL:         testURL(t, "https://example.com/item"),
		Title:       "Feed Item",
		Content:     ptrTo("<p>item</p>"),
		PublishedAt: &publishedAt,
	}

	sends := &fakeKindleSendRepository{
		savedPages: []domain.SavedPage{page},
		feeds:      []domain.Feed{feed},
		items:      map[string][]domain.FeedItem{"feed-1": {item}},
	}

	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return []domain.EPUBBook{{
			Title:        "留白 " + dateStr,
			Filename:     "liubai.epub",
			SavedPageIDs: []string{"page-1"},
			FeedItemIDs:  []string{"item-1"},
			ArticleCount: 2,
		}}, nil
	}}
	mailer := &fakeMailSender{}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		FeedItems:   &fakeFeedItemRepository{},
		EPUBBuilder: builder,
		MailSender:  mailer,
		Location:    loc,
		Now:         func() time.Time { return now },
	})

	rec, err := sender.EnqueueManual(context.Background())
	if err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	if rec.ID == "" {
		t.Fatal("record ID = empty, want generated id")
	}

	if rec.Trigger != domain.KindleTriggerManual {
		t.Fatalf("record trigger = %s, want %s", rec.Trigger, domain.KindleTriggerManual)
	}

	if rec.Status != domain.KindleStatusRunning {
		t.Fatalf("record status = %s, want %s", rec.Status, domain.KindleStatusRunning)
	}

	if !rec.StartedAt.Equal(now) {
		t.Fatalf("record startedAt = %v, want %v", rec.StartedAt, now)
	}

	if !sender.IsRunning() {
		t.Fatal("IsRunning() = false right after enqueue")
	}

	sender.Wait()

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after job finished")
	}

	captured := builder.captured()
	if captured.dateStr != "2026-03-15" {
		t.Fatalf("build dateStr = %q, want %q", captured.dateStr, "2026-03-15")
	}

	if len(captured.articles) != 2 {
		t.Fatalf("articles = %d, want 2", len(captured.articles))
	}

	savedArticle := captured.articles[0]
	if !savedArticle.IsSavedPage || savedArticle.ID != "page-1" || savedArticle.SourceTitle != "example.com" {
		t.Fatalf("saved page article = %+v", savedArticle)
	}

	if savedArticle.HTMLBody != "<p>saved</p>" || savedArticle.URL != "https://example.com/page" {
		t.Fatalf("saved page body/url = %q/%q", savedArticle.HTMLBody, savedArticle.URL)
	}

	feedArticle := captured.articles[1]
	if feedArticle.IsSavedPage || feedArticle.ID != "item-1" || feedArticle.SourceTitle != "Example Feed" {
		t.Fatalf("feed article = %+v", feedArticle)
	}

	if feedArticle.HTMLBody != "<p>item</p>" {
		t.Fatalf("feed article body = %q, want %q", feedArticle.HTMLBody, "<p>item</p>")
	}

	accepted := sends.acceptedList()
	if len(accepted) != 1 {
		t.Fatalf("accepted books = %d, want 1", len(accepted))
	}

	if accepted[0].sendID != rec.ID || !slices.Equal(accepted[0].savedPageIDs, []string{"page-1"}) || !slices.Equal(accepted[0].feedItemIDs, []string{"item-1"}) {
		t.Fatalf("accepted book = %+v", accepted[0])
	}

	if accepted[0].articleDelta != 2 {
		t.Fatalf("accepted article delta = %d, want 2", accepted[0].articleDelta)
	}

	completed := sends.completedList()
	if len(completed) != 1 {
		t.Fatalf("completed sends = %d, want 1", len(completed))
	}

	if completed[0].status != domain.KindleStatusSucceeded || completed[0].errSummary != nil {
		t.Fatalf("completed send = %+v", completed[0])
	}

	if !completed[0].finishedAt.Equal(now) {
		t.Fatalf("finishedAt = %v, want %v", completed[0].finishedAt, now)
	}

	mails := mailer.sentList()
	if len(mails) != 1 {
		t.Fatalf("sent mails = %d, want 1", len(mails))
	}

	if mails[0].delivery.SMTP.Host != "smtp.example.com" {
		t.Fatalf("mail SMTP host = %q, want smtp.example.com", mails[0].delivery.SMTP.Host)
	}
}

func TestEnqueueManualRejectsConcurrentSend(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return nil, nil
	}}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		FeedItems:   &fakeFeedItemRepository{},
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("first EnqueueManual() error = %v", err)
	}

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for job to start")
	}

	if !sender.IsRunning() {
		t.Fatal("IsRunning() = false while job is running")
	}

	if _, err := sender.EnqueueManual(context.Background()); err == nil {
		t.Fatal("second EnqueueManual() error = nil, want KindleSendInProgress")
	} else {
		requireErrorCode(t, err, domain.ErrKindleSendInProgress)
	}

	close(release)
	sender.Wait()

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after job finished")
	}
}

func TestEnqueueManualSnapshotsDelivery(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	settings := configuredDeliverySettings()
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return []domain.EPUBBook{{ArticleCount: len(articles)}}, nil
	}}
	mailer := &fakeMailSender{}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: settings},
		KindleSends: &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}},
		FeedItems:   &fakeFeedItemRepository{},
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for job to start")
	}

	settings.SMTP.Host = "mutated.example.com"
	*settings.SMTP.Password = "mutated-password"
	settings.Kindle.KindleEmail = "mutated@kindle.com"

	close(release)
	sender.Wait()

	mails := mailer.sentList()
	if len(mails) != 1 {
		t.Fatalf("sent mails = %d, want 1", len(mails))
	}

	if mails[0].delivery.SMTP.Host != "smtp.example.com" {
		t.Fatalf("snapshot SMTP host = %q, want smtp.example.com", mails[0].delivery.SMTP.Host)
	}

	if mails[0].delivery.SMTP.Password == nil || *mails[0].delivery.SMTP.Password != "smtp-password" {
		t.Fatalf("snapshot SMTP password = %v, want smtp-password", mails[0].delivery.SMTP.Password)
	}

	if mails[0].delivery.KindleEmail != "reader@kindle.com" {
		t.Fatalf("snapshot KindleEmail = %q, want reader@kindle.com", mails[0].delivery.KindleEmail)
	}
}

func TestCloneKindleDeliveryDeepCopiesPointers(t *testing.T) {
	t.Parallel()

	originalSMTP := domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
		User:        ptrTo("user"),
		Password:    ptrTo("password"),
	}

	cloned := cloneKindleDelivery(originalSMTP, "reader@kindle.com")

	*originalSMTP.User = "changed-user"
	*originalSMTP.Password = "changed-password"

	if *cloned.SMTP.User != "user" || *cloned.SMTP.Password != "password" {
		t.Fatalf("cloned string pointers were mutated: %+v", cloned)
	}

	if cloned.KindleEmail != "reader@kindle.com" {
		t.Fatalf("cloned KindleEmail = %q, want reader@kindle.com", cloned.KindleEmail)
	}

	empty := cloneKindleDelivery(domain.SMTPSettings{}, "")
	if empty.SMTP.User != nil || empty.SMTP.Password != nil {
		t.Fatalf("nil pointers not preserved: %+v", empty)
	}
}

func TestRunJobEmptyUnreadSucceedsWithoutMail(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	sends := &fakeKindleSendRepository{}
	builder := &fakeEPUBBuilder{}
	mailer := &fakeMailSender{}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if builder.callCount() != 0 {
		t.Fatalf("BuildBooks calls = %d, want 0", builder.callCount())
	}

	if len(mailer.sentList()) != 0 {
		t.Fatal("SendEPUB called for an empty library")
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded || completed[0].errSummary != nil {
		t.Fatalf("completed sends = %+v", completed)
	}
}

func TestCompleteSendRetriesTerminalStatusWrite(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	sends := &fakeKindleSendRepository{completeFailure: completeSendAttempts - 1}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if calls := sends.completeCallsList(); calls != completeSendAttempts {
		t.Fatalf("CompleteSend calls = %d, want %d", calls, completeSendAttempts)
	}

	completed := sends.completedList()
	if len(completed) != completeSendAttempts {
		t.Fatalf("completed sends = %d, want %d", len(completed), completeSendAttempts)
	}

	if completed[len(completed)-1].status != domain.KindleStatusSucceeded {
		t.Fatalf("last completed status = %s, want succeeded", completed[len(completed)-1].status)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after the job finished")
	}
}

func TestRunJobCompletesWithoutCanceledContext(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}

	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	sender := NewKindleSender(KindleConfig{
		BaseCtx:     baseCtx,
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			cancelBase()

			return nil, context.Canceled
		}},
		MailSender: &fakeMailSender{},
		Now:        func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want one failed send", completed)
	}
}

func TestRunJobFailures(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	book := domain.EPUBBook{Title: "book", Filename: "book.epub", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}

	cases := []struct {
		name        string
		configure   func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender)
		wantSummary string
		wantCreated int
	}{
		{
			name: "unread list failure",
			configure: func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender) {
				sends.listErr = errors.New("list failed for https://alice:secret@example.com/x")
			},
			wantSummary: "list failed for https://example.com/x",
			wantCreated: 1,
		},
		{
			name: "epub build failure",
			configure: func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender) {
				builder.build = func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
					return nil, errors.New("build failed")
				}
			},
			wantSummary: "build failed",
			wantCreated: 1,
		},
		{
			name: "record accepted failure",
			configure: func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender) {
				sends.recordErr = errors.New("record failed")
			},
			wantSummary: "record failed",
			wantCreated: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}
			builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
				return []domain.EPUBBook{book}, nil
			}}
			mailer := &fakeMailSender{}
			tc.configure(sends, builder, mailer)

			sender := NewKindleSender(KindleConfig{
				Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
				KindleSends: sends,
				EPUBBuilder: builder,
				MailSender:  mailer,
				Now:         func() time.Time { return now },
			})

			if _, err := sender.EnqueueManual(context.Background()); err != nil {
				t.Fatalf("EnqueueManual() error = %v", err)
			}

			sender.Wait()

			completed := sends.completedList()
			if len(completed) != 1 {
				t.Fatalf("completed sends = %d, want 1", len(completed))
			}

			if completed[0].status != domain.KindleStatusFailed {
				t.Fatalf("completed status = %s, want failed", completed[0].status)
			}

			if completed[0].errSummary == nil || *completed[0].errSummary != tc.wantSummary {
				t.Fatalf("completed summary = %v, want %q", completed[0].errSummary, tc.wantSummary)
			}

			if strings.Contains(*completed[0].errSummary, "alice:secret") {
				t.Fatalf("summary leaks credentials: %q", *completed[0].errSummary)
			}

			if want := tc.wantCreated; len(sends.createdList()) != want {
				t.Fatalf("created sends = %d, want %d", len(sends.createdList()), want)
			}
		})
	}
}

func TestRunJobStopsAfterMailFailure(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}

	books := []domain.EPUBBook{
		{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1},
		{Title: "book-2", FeedItemIDs: []string{"item-1"}, ArticleCount: 1},
	}

	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return books, nil
	}}

	mailCalls := 0
	mailer := &fakeMailSender{}
	mailer.send = func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
		mailCalls++
		if mailCalls == 2 {
			return errors.New("smtp rejected book")
		}

		return nil
	}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if mailCalls != 2 {
		t.Fatalf("SendEPUB calls = %d, want 2", mailCalls)
	}

	accepted := sends.acceptedList()
	if len(accepted) != 1 || !slices.Equal(accepted[0].savedPageIDs, []string{"page-1"}) {
		t.Fatalf("accepted books = %+v, want only the first book", accepted)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want one failed send", completed)
	}

	if completed[0].errSummary == nil || *completed[0].errSummary != "smtp rejected book" {
		t.Fatalf("summary = %v, want %q", completed[0].errSummary, "smtp rejected book")
	}
}

func TestRunJobResolvesFeedItemBodies(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)

	defaultFeed := domain.Feed{ID: "default", Title: "Default Feed", ReaderMode: domain.ReaderModeDefault, Order: domain.SortOrderNewest}
	extractedFeed := domain.Feed{ID: "extracted", Title: "Extracted Feed", ReaderMode: domain.ReaderModeExtracted, Order: domain.SortOrderNewest}
	embeddedFeed := domain.Feed{ID: "embedded", Title: "Embedded Feed", ReaderMode: domain.ReaderModeEmbedded, Order: domain.SortOrderNewest}

	items := map[string][]domain.FeedItem{
		"default": {
			{ID: "default-content", FeedID: "default", URL: testURL(t, "https://example.com/default-content"), Title: "Default Content", Content: ptrTo("<p>content</p>"), Description: ptrTo("<p>description</p>")},
			{ID: "default-description", FeedID: "default", URL: testURL(t, "https://example.com/default-description"), Title: "Default Description", Description: ptrTo("<p>description</p>")},
			{ID: "default-empty", FeedID: "default", URL: testURL(t, "https://example.com/default-empty"), Title: "Default Empty"},
		},
		"extracted": {
			{ID: "extracted-cached", FeedID: "extracted", URL: testURL(t, "https://example.com/extracted-cached"), Title: "Cached", Content: ptrTo("<p>default content</p>"), ExtractedContent: ptrTo("<p>cached extracted</p>")},
			{ID: "extracted-fetch", FeedID: "extracted", URL: testURL(t, "https://example.com/uncached"), Title: "Fetched"},
			{ID: "extracted-fetch-fail", FeedID: "extracted", URL: testURL(t, "https://example.com/fetch-fail"), Title: "Fetch Fail", Content: ptrTo("<p>fetch fallback</p>")},
			{ID: "extracted-extract-fail", FeedID: "extracted", URL: testURL(t, "https://example.com/extract-fail"), Title: "Extract Fail", Description: ptrTo("<p>description fallback</p>")},
			{ID: "extracted-blank", FeedID: "extracted", URL: testURL(t, "https://example.com/blank"), Title: "Blank Extract", Content: ptrTo("<p>blank fallback</p>")},
		},
		"embedded": {
			{ID: "embedded-fetch", FeedID: "embedded", URL: testURL(t, "https://example.com/uncached"), Title: "Embedded Fetched"},
		},
	}

	sends := &fakeKindleSendRepository{
		feeds: []domain.Feed{defaultFeed, extractedFeed, embeddedFeed},
		items: items,
	}

	fetcher := &fakeWebpageFetcher{}
	fetcher.fetch = func(ctx context.Context, url domain.NormalizedURL) (string, string, error) {
		switch url.Raw() {
		case "https://example.com/uncached":
			return "<html>", "https://example.com/final", nil
		case "https://example.com/extract-fail":
			return "<bad>", "https://example.com/final", nil
		case "https://example.com/blank":
			return "<blank>", "https://example.com/final", nil
		default:
			return "", "", errors.New("fetch failed")
		}
	}

	extractor := &fakeArticleExtractor{}
	extractor.extract = func(ctx context.Context, htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
		switch htmlBody {
		case "<html>":
			return domain.ExtractedArticle{Content: "<p>extracted body</p>"}, nil
		case "<blank>":
			return domain.ExtractedArticle{Content: "   "}, nil
		default:
			return domain.ExtractedArticle{}, errors.New("extraction failed")
		}
	}

	feedItems := &fakeFeedItemRepository{}
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return nil, nil
	}}

	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{settings: configuredDeliverySettings()},
		KindleSends: sends,
		FeedItems:   feedItems,
		Fetcher:     fetcher,
		Extractor:   extractor,
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if sends.completedList()[0].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed status = %s, want succeeded", sends.completedList()[0].status)
	}

	captured := builder.captured()
	bodies := make(map[string]string, len(captured.articles))
	for _, article := range captured.articles {
		bodies[article.ID] = article.HTMLBody
	}

	wantBodies := map[string]string{
		"default-content":        "<p>content</p>",
		"default-description":    "<p>description</p>",
		"default-empty":          "",
		"extracted-cached":       "<p>cached extracted</p>",
		"extracted-fetch":        "<p>extracted body</p>",
		"extracted-fetch-fail":   "<p>fetch fallback</p>",
		"extracted-extract-fail": "<p>description fallback</p>",
		"extracted-blank":        "<p>blank fallback</p>",
		"embedded-fetch":         "<p>extracted body</p>",
	}

	for id, want := range wantBodies {
		if got, ok := bodies[id]; !ok {
			t.Fatalf("article %q missing from build", id)
		} else if got != want {
			t.Fatalf("article %q body = %q, want %q", id, got, want)
		}
	}

	fetched := fetcher.callList()
	if slices.Contains(fetched, "https://example.com/extracted-cached") {
		t.Fatal("cached extracted content was fetched again")
	}

	for _, raw := range fetched {
		if strings.HasPrefix(raw, "https://example.com/default-") {
			t.Fatalf("default-mode item %q was fetched", raw)
		}
	}

	saved := feedItems.savedList()
	savedIDs := make([]string, 0, len(saved))
	for _, entry := range saved {
		savedIDs = append(savedIDs, entry.id)
		if entry.content != "<p>extracted body</p>" {
			t.Fatalf("saved extracted content = %q, want %q", entry.content, "<p>extracted body</p>")
		}
	}

	slices.Sort(savedIDs)
	if !slices.Equal(savedIDs, []string{"embedded-fetch", "extracted-fetch"}) {
		t.Fatalf("cached extracted IDs = %v, want [embedded-fetch extracted-fetch]", savedIDs)
	}
}

func TestCheckScheduleStartsDueSend(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("CST", 8*60*60)
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)

	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		Location:    loc,
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	sender.Wait()

	wantNext := time.Date(2026, 3, 15, 1, 0, 0, 0, time.UTC)
	advances := settings.advanceList()
	if len(advances) != 1 || !advances[0].Equal(wantNext) {
		t.Fatalf("advances = %v, want [%v]", advances, wantNext)
	}

	created := sends.createdList()
	if len(created) != 1 {
		t.Fatalf("created sends = %d, want 1", len(created))
	}

	if created[0].Trigger != domain.KindleTriggerScheduled || created[0].Status != domain.KindleStatusRunning {
		t.Fatalf("created send = %+v", created[0])
	}

	if !created[0].StartedAt.Equal(now) {
		t.Fatalf("created startedAt = %v, want %v", created[0].StartedAt, now)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed sends = %+v", completed)
	}
}

func TestCheckScheduleSkipsWhenNotDueOrUnconfigured(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("CST", 8*60*60)
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	configured := func() domain.Settings {
		settings := configuredDeliverySettings()
		settings.Kindle.SendTime = ptrTo("09:00")
		settings.Kindle.NextSendAt = &past

		return settings
	}

	cases := []struct {
		name      string
		configure func(settings *domain.Settings)
	}{
		{
			name: "missing smtp and kindle",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
				settings.Kindle = nil
			},
		},
		{
			name: "smtp configured but kindle nil",
			configure: func(settings *domain.Settings) {
				settings.Kindle = nil
			},
		},
		{
			name: "kindle configured but smtp nil",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
			},
		},
		{
			name: "blank kindle email",
			configure: func(settings *domain.Settings) {
				settings.Kindle.KindleEmail = " "
			},
		},
		{
			name: "blank smtp host",
			configure: func(settings *domain.Settings) {
				settings.SMTP.Host = " "
			},
		},
		{
			name: "next send at in the future",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = &future
			},
		},
		{
			name: "missing send time",
			configure: func(settings *domain.Settings) {
				settings.Kindle.SendTime = nil
			},
		},
		{
			name: "missing next send at",
			configure: func(settings *domain.Settings) {
				settings.Kindle.NextSendAt = nil
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			deliverySettings := configured()
			tc.configure(&deliverySettings)
			settings := &fakeSettingRepository{settings: deliverySettings}
			sends := &fakeKindleSendRepository{}

			sender := NewKindleSender(KindleConfig{
				Settings:    settings,
				KindleSends: sends,
				Location:    loc,
				Now:         func() time.Time { return now },
			})

			if err := sender.CheckSchedule(context.Background()); err != nil {
				t.Fatalf("CheckSchedule() error = %v", err)
			}

			if advances := settings.advanceList(); len(advances) != 0 {
				t.Fatalf("advances = %v, want none", advances)
			}

			if created := sends.createdList(); len(created) != 0 {
				t.Fatalf("created sends = %d, want 0", len(created))
			}
		})
	}
}

func TestCheckScheduleReturnsSettingsError(t *testing.T) {
	t.Parallel()

	want := errors.New("settings unavailable")
	sender := NewKindleSender(KindleConfig{
		Settings:    &fakeSettingRepository{getErr: want},
		KindleSends: &fakeKindleSendRepository{},
	})

	if err := sender.CheckSchedule(context.Background()); !errors.Is(err, want) {
		t.Fatalf("CheckSchedule() error = %v, want %v", err, want)
	}
}

func TestCheckScheduleReturnsInvalidSendTimeError(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("25:99")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Minute))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		Now:         func() time.Time { return now },
	})

	err := sender.CheckSchedule(context.Background())
	requireErrorCode(t, err, domain.ErrInvalidKindleSetting)

	if advances := settings.advanceList(); len(advances) != 0 {
		t.Fatalf("advances = %v, want none", advances)
	}
	if created := sends.createdList(); len(created) != 0 {
		t.Fatalf("created sends = %d, want 0", len(created))
	}
}

func TestCheckScheduleReturnsAdvanceError(t *testing.T) {
	t.Parallel()

	want := errors.New("advance failed")
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings, advanceErr: want}
	sends := &fakeKindleSendRepository{}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); !errors.Is(err, want) {
		t.Fatalf("CheckSchedule() error = %v, want %v", err, want)
	}

	// The running record is created before the advance so a failed advance never
	// loses the due run, but it must be closed instead of staying running.
	created := sends.createdList()
	if len(created) != 1 {
		t.Fatalf("created sends = %d, want 1", len(created))
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].sendID != created[0].ID || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want the created send marked failed", completed)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after advance failure")
	}
}

func TestCheckScheduleReturnsCreateError(t *testing.T) {
	t.Parallel()

	want := errors.New("create failed")
	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{createErr: want}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		Now:         func() time.Time { return now },
	})

	if err := sender.CheckSchedule(context.Background()); !errors.Is(err, want) {
		t.Fatalf("CheckSchedule() error = %v, want %v", err, want)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after CreateRunning failure")
	}
}

func TestCheckScheduleSkipsWhileRunning(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return nil, nil
	}}

	sender := NewKindleSender(KindleConfig{
		Settings:    settings,
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for manual job to start")
	}

	if err := sender.CheckSchedule(context.Background()); err != nil {
		t.Fatalf("CheckSchedule() error = %v", err)
	}

	if advances := settings.advanceList(); len(advances) != 1 {
		t.Fatalf("advances = %d, want 1", len(advances))
	}

	if created := sends.createdList(); len(created) != 1 {
		t.Fatalf("created sends = %d, want 1 (manual only)", len(created))
	}

	if created := sends.createdList(); created[0].Trigger != domain.KindleTriggerManual {
		t.Fatalf("created trigger = %s, want manual", created[0].Trigger)
	}

	close(release)
	sender.Wait()
}

func TestStartSchedulerChecksImmediately(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings}
	sends := &fakeKindleSendRepository{}

	sender := NewKindleSender(KindleConfig{
		Settings:     settings,
		KindleSends:  sends,
		EPUBBuilder:  &fakeEPUBBuilder{},
		MailSender:   &fakeMailSender{},
		TickInterval: time.Hour,
		Now:          func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		sender.StartScheduler(ctx)
		close(done)
	}()

	waitFor(t, func() bool { return len(sends.createdList()) >= 1 }, "startup schedule catch-up")

	cancel()

	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("StartScheduler did not return after context cancellation")
	}

	sender.Wait()
}

func TestStartSchedulerTicks(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 10, 30, 0, 0, time.UTC)
	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.SendTime = ptrTo("09:00")
	deliverySettings.Kindle.NextSendAt = ptrTo(now.Add(-time.Hour))

	settings := &fakeSettingRepository{settings: deliverySettings, keepDue: true}
	sends := &fakeKindleSendRepository{}

	sender := NewKindleSender(KindleConfig{
		Settings:     settings,
		KindleSends:  sends,
		EPUBBuilder:  &fakeEPUBBuilder{},
		MailSender:   &fakeMailSender{},
		TickInterval: 10 * time.Millisecond,
		Now:          func() time.Time { return now },
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		sender.StartScheduler(ctx)
		close(done)
	}()

	waitFor(t, func() bool { return len(sends.createdList()) >= 2 }, "scheduled tick")

	cancel()

	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("StartScheduler did not return after context cancellation")
	}

	sender.Wait()
}
