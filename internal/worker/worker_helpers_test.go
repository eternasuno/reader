package worker

import (
	"context"
	"errors"
	"reader/internal/domain"
	"strings"
	"sync"
	"testing"
	"time"
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

type fatalRecorder struct {
	mu   sync.Mutex
	errs []error
}

func (r *fatalRecorder) Record(err error) {
	r.mu.Lock()
	r.errs = append(r.errs, err)
	r.mu.Unlock()
}

func (r *fatalRecorder) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.errs)
}

func (r *fatalRecorder) Errors() []error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]error(nil), r.errs...)
}

func newTestKindleSender(t *testing.T, cfg KindleConfig) *KindleSender {
	t.Helper()

	if cfg.BaseCtx == nil {
		cfg.BaseCtx = context.Background()
	}

	if cfg.OnFatal == nil {
		cfg.OnFatal = func(err error) {
			t.Errorf("unexpected fatal: %v", err)
		}
	}

	return NewKindleSender(cfg)
}

func newTestRefreshQueue(t *testing.T, cfg RefreshConfig) *RefreshQueue {
	t.Helper()

	if cfg.OnFatal == nil {
		cfg.OnFatal = func(err error) {
			t.Errorf("unexpected fatal: %v", err)
		}
	}

	return NewRefreshQueue(cfg)
}

type recordedFailure struct {
	feedID     string
	summary    string
	startedAt  time.Time
	finishedAt time.Time
}

type appliedSync struct {
	feedID     string
	meta       domain.FeedSyncMeta
	startedAt  time.Time
	finishedAt time.Time
	newItems   []domain.FeedItem
	deleteIDs  []string
}

type fakeFeedRepository struct {
	mu        sync.Mutex
	feeds     map[string]domain.Feed
	list      []domain.Feed
	listErr   error
	getErr    error
	onGet     func(string)
	onSync    func(string)
	applyErr  error
	recordErr error

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
	if r.onGet != nil {
		r.onGet(id)
	}

	if r.getErr != nil {
		return nil, r.getErr
	}

	feed, ok := r.feeds[id]
	if !ok {
		return nil, nil
	}

	return &feed, nil
}

func (r *fakeFeedRepository) Create(ctx context.Context, feed domain.Feed) (domain.Feed, error) {
	return feed, nil
}

func (r *fakeFeedRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.feeds, id)

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

func (r *fakeFeedRepository) RecordRefreshFailure(ctx context.Context, id string, errSummary string, startedAt, finishedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.recordErr != nil {
		return r.recordErr
	}

	r.failures = append(r.failures, recordedFailure{feedID: id, summary: errSummary, startedAt: startedAt, finishedAt: finishedAt})

	return nil
}

func (r *fakeFeedRepository) ApplySync(ctx context.Context, feedID string, meta domain.FeedSyncMeta, startedAt, finishedAt time.Time, newItems []domain.FeedItem, deleteIDs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.applyErr != nil {
		return r.applyErr
	}

	if r.onSync != nil {
		r.onSync(feedID)
	}

	r.syncs = append(r.syncs, appliedSync{
		feedID:     feedID,
		meta:       meta,
		startedAt:  startedAt,
		finishedAt: finishedAt,
		newItems:   append([]domain.FeedItem(nil), newItems...),
		deleteIDs:  append([]string(nil), deleteIDs...),
	})

	return nil
}

func (r *fakeFeedRepository) ImportOPML(ctx context.Context, doc domain.OPMLDocument) (domain.OPMLImportResult, []string, error) {
	return domain.OPMLImportResult{}, nil, nil
}

func (r *fakeFeedRepository) ExportOPML(ctx context.Context) ([]domain.OPMLExportFolder, []domain.Feed, error) {
	return nil, nil, nil
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
	stored  []domain.StoredRef
	listErr error
	saveErr error
	// extracted holds the content already persisted per item ID; a non-blank
	// entry is a winner that SaveExtractedContentIfEmpty must preserve.
	extracted map[string]string
	saved     []savedExtraction
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

func (r *fakeFeedItemRepository) ListStoredRefsByFeed(ctx context.Context, feedID string) ([]domain.StoredRef, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.listErr != nil {
		return nil, r.listErr
	}

	return append([]domain.StoredRef(nil), r.stored...), nil
}

func (r *fakeFeedItemRepository) GetByID(ctx context.Context, id string) (*domain.FeedItem, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) UnreadCounts(ctx context.Context, _ string) ([]domain.FeedUnreadCount, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) SetRead(ctx context.Context, id string, read bool) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkIDsRead(ctx context.Context, ids []string) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkAllRead(ctx context.Context, _ string) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkFeedRead(ctx context.Context, feedID, _ string) error {
	return nil
}

func (r *fakeFeedItemRepository) MarkFolderRead(ctx context.Context, folderID, _ string) error {
	return nil
}

// SaveExtractedContentIfEmpty mirrors the repository contract: the first
// non-blank content wins and later writers receive it with wrote == false.
func (r *fakeFeedItemRepository) SaveExtractedContentIfEmpty(ctx context.Context, id string, content string) (*domain.FeedItem, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.saveErr != nil {
		return nil, false, r.saveErr
	}

	if existing := r.extracted[id]; strings.TrimSpace(existing) != "" {
		return &domain.FeedItem{ID: id, ExtractedContent: &existing}, false, nil
	}

	if r.extracted == nil {
		r.extracted = make(map[string]string)
	}

	r.extracted[id] = content
	r.saved = append(r.saved, savedExtraction{id: id, content: content})

	stored := content

	return &domain.FeedItem{ID: id, ExtractedContent: &stored}, true, nil
}

func (r *fakeFeedItemRepository) extractedFor(id string) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.extracted[id]
}

func (r *fakeFeedItemRepository) savedList() []savedExtraction {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]savedExtraction(nil), r.saved...)
}

type fakeSettingRepository struct {
	mu       sync.Mutex
	settings domain.Settings
	getErr   error
	gets     int
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

func (r *fakeSettingRepository) UpdateKindle(ctx context.Context, kindle domain.KindleSettings, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	copied := kindle
	r.settings.Kindle = &copied

	return nil
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
	panics bool
	calls  int
}

func (p *fakeFeedParser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.calls++

	if p.panics {
		panic("hostile feed")
	}

	return p.parsed, p.err
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
	return domain.KindleSettings{KindleEmail: "reader@kindle.com"}
}

func configuredDeliverySettings() domain.Settings {
	smtp := configuredSMTPSettings()
	kindle := configuredKindleSettings()

	return domain.Settings{
		SMTP:   &smtp,
		Kindle: &kindle,
	}
}

// sequenceClock returns each time in order, then repeats the last one.
func sequenceClock(times ...time.Time) func() time.Time {
	var (
		mu   sync.Mutex
		next int
	)

	return func() time.Time {
		mu.Lock()
		defer mu.Unlock()

		current := times[min(next, len(times)-1)]
		next++

		return current
	}
}
