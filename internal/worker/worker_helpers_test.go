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

// errorScript yields the scripted error for each successive call and then
// repeats after; a nil entry means that call succeeds.
type errorScript struct {
	steps []error
	after error
	calls int
}

func (s *errorScript) next() error {
	s.calls++

	if len(s.steps) == 0 {
		return s.after
	}

	err := s.steps[0]
	s.steps = s.steps[1:]

	return err
}

type claimedRefresh struct {
	attemptID string
	feedID    string
	now       time.Time
}

type succeededRefresh struct {
	attemptID     string
	feedID        string
	meta          domain.FeedSyncMeta
	entries       []domain.ParsedFeedEntry
	finishedAt    time.Time
	nextRefreshAt time.Time
}

type failedRefresh struct {
	attemptID     string
	feedID        string
	summary       string
	finishedAt    time.Time
	nextRefreshAt time.Time
}

type releasedRefresh struct {
	attemptID string
	feedID    string
}

// fakeFeedRepository models the refresh queue: due feeds are claimed one at a
// time, a claimed feed is running until it is succeeded, failed, or released,
// and a released feed is due again. A failed write leaves the attempt running.
type fakeFeedRepository struct {
	mu      sync.Mutex
	due     []domain.Feed
	running map[string]domain.Feed

	claimScript   errorScript
	succeedScript errorScript
	failScript    errorScript
	releaseScript errorScript

	claimCalls int
	claims     []claimedRefresh
	succeeded  []succeededRefresh
	failed     []failedRefresh
	released   []releasedRefresh
}

// newTestFeedRepository returns a repository where the given feeds are due.
func newTestFeedRepository(due ...domain.Feed) *fakeFeedRepository {
	return &fakeFeedRepository{due: append([]domain.Feed(nil), due...), running: make(map[string]domain.Feed)}
}

func (r *fakeFeedRepository) List(ctx context.Context) ([]domain.Feed, error) {
	return nil, nil
}

func (r *fakeFeedRepository) GetByID(ctx context.Context, id string) (*domain.Feed, error) {
	return nil, nil
}

func (r *fakeFeedRepository) Create(ctx context.Context, feed domain.Feed, now time.Time) (domain.Feed, error) {
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

func (r *fakeFeedRepository) RequestRefresh(ctx context.Context, feedID string, now time.Time) error {
	return nil
}

func (r *fakeFeedRepository) RecoverRunningRefreshes(ctx context.Context, now time.Time) error {
	return nil
}

func (r *fakeFeedRepository) ClaimDueRefresh(ctx context.Context, attemptID string, now time.Time) (*domain.Feed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.claimCalls++

	if err := r.claimScript.next(); err != nil {
		return nil, err
	}

	if len(r.due) == 0 {
		return nil, nil
	}

	feed := r.due[0]
	r.due = r.due[1:]
	r.running[attemptID] = feed
	r.claims = append(r.claims, claimedRefresh{attemptID: attemptID, feedID: feed.ID, now: now})

	return &feed, nil
}

func (r *fakeFeedRepository) SucceedRefresh(ctx context.Context, attemptID string, feedID string, meta domain.FeedSyncMeta, entries []domain.ParsedFeedEntry, finishedAt, nextRefreshAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.succeedScript.next(); err != nil {
		return err
	}

	delete(r.running, attemptID)

	r.succeeded = append(r.succeeded, succeededRefresh{
		attemptID:     attemptID,
		feedID:        feedID,
		meta:          meta,
		entries:       append([]domain.ParsedFeedEntry(nil), entries...),
		finishedAt:    finishedAt,
		nextRefreshAt: nextRefreshAt,
	})

	return nil
}

func (r *fakeFeedRepository) FailRefresh(ctx context.Context, attemptID string, feedID string, errSummary string, finishedAt, nextRefreshAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.failScript.next(); err != nil {
		return err
	}

	delete(r.running, attemptID)

	r.failed = append(r.failed, failedRefresh{
		attemptID:     attemptID,
		feedID:        feedID,
		summary:       errSummary,
		finishedAt:    finishedAt,
		nextRefreshAt: nextRefreshAt,
	})

	return nil
}

func (r *fakeFeedRepository) ReleaseRefresh(ctx context.Context, attemptID string, feedID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.releaseScript.next(); err != nil {
		return err
	}

	feed, ok := r.running[attemptID]
	if ok {
		delete(r.running, attemptID)
		r.due = append([]domain.Feed{feed}, r.due...)
	}

	r.released = append(r.released, releasedRefresh{attemptID: attemptID, feedID: feedID})

	return nil
}

func (r *fakeFeedRepository) ImportOPML(ctx context.Context, doc domain.OPMLDocument, now time.Time) (domain.OPMLImportResult, error) {
	return domain.OPMLImportResult{}, nil
}

func (r *fakeFeedRepository) ExportOPML(ctx context.Context) ([]domain.OPMLExportFolder, []domain.Feed, error) {
	return nil, nil, nil
}

// makeDue marks a feed due, as RequestRefresh or an elapsed schedule would.
func (r *fakeFeedRepository) makeDue(feed domain.Feed) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.due = append(r.due, feed)
}

func (r *fakeFeedRepository) claimCallCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.claimCalls
}

func (r *fakeFeedRepository) claimList() []claimedRefresh {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]claimedRefresh(nil), r.claims...)
}

func (r *fakeFeedRepository) succeededList() []succeededRefresh {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]succeededRefresh(nil), r.succeeded...)
}

func (r *fakeFeedRepository) failedList() []failedRefresh {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]failedRefresh(nil), r.failed...)
}

func (r *fakeFeedRepository) releasedList() []releasedRefresh {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]releasedRefresh(nil), r.released...)
}

type savedExtraction struct {
	id      string
	content string
}

type fakeFeedItemRepository struct {
	mu      sync.Mutex
	saveErr error
	// extracted holds the content already persisted per item ID; a non-blank
	// entry is a winner that SaveExtractedContentIfEmpty must preserve.
	extracted map[string]string
	saved     []savedExtraction
}

func (r *fakeFeedItemRepository) SnapshotAll(ctx context.Context, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) SnapshotByFolder(ctx context.Context, folderID string, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) SnapshotByFeed(ctx context.Context, feedID string, order domain.SortOrder, params domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	return nil, nil
}

func (r *fakeFeedItemRepository) GetByIDs(ctx context.Context, ids []string) ([]domain.FeedItem, error) {
	return nil, nil
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

func (r *fakeSettingRepository) UpdateBrowserless(ctx context.Context, browserless domain.BrowserlessSettings) error {
	return nil
}

func (r *fakeSettingRepository) DeleteBrowserlessToken(ctx context.Context) error {
	return nil
}

func (r *fakeSettingRepository) DeleteBrowserless(ctx context.Context) error {
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

	// Mirrors the sqlite repository: NextSendAt is repository-owned, recomputed
	// when the schedule is enabled or changed, kept when unchanged, cleared when off.
	copied := kindle
	copied.NextSendAt = nil

	if copied.Schedule != nil {
		previous := r.settings.Kindle
		if previous != nil && previous.Schedule != nil && *previous.Schedule == *copied.Schedule {
			copied.NextSendAt = previous.NextSendAt
		} else {
			loc, err := domain.LoadKindleLocation(copied.Schedule.Timezone)
			if err != nil {
				return err
			}

			next := domain.NextKindleOccurrence(*copied.Schedule, loc, now)
			copied.NextSendAt = &next
		}
	}

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
	return domain.KindleSettings{Language: domain.KindleLanguageChinese, KindleEmail: "reader@kindle.com"}
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
