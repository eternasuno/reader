package worker

import (
	"context"
	"errors"
	"reader/internal/domain"
	"sync"
	"time"
)

type acceptedBook struct {
	sendID       string
	bookIndex    int
	savedPageIDs []string
	feedItemIDs  []string
	articleDelta int
}

type completedSend struct {
	sendID      string
	status      domain.KindleStatus
	errSummary  *string
	finishedAt  time.Time
	ctxErr      error
	hasDeadline bool
}

type fakeKindleSendRepository struct {
	mu              sync.Mutex
	settingsRepo    *fakeSettingRepository
	savedPages      []domain.SavedPage
	feeds           []domain.Feed
	items           map[string][]domain.FeedItem
	listErr         error
	getErr          error
	claimErr        error
	claimFailure    int
	recordErr       error
	recordFailure   int
	completeErr     error
	completeFailure int
	keepDue         bool
	running         bool
	beforeClaim     func()
	onList          func()
	onGetArticle    func(ref domain.KindleArticleRef)
	onRecord        func(ctx context.Context)
	onComplete      func(err error)
	afterComplete   func()

	listCalls     int
	recordCalls   int
	completeCalls int
	advances      []time.Time
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

func (r *fakeKindleSendRepository) currentSettingsLocked() (domain.Settings, error) {
	if r.settingsRepo == nil {
		return configuredDeliverySettings(), nil
	}

	return r.settingsRepo.Get(context.Background())
}

func (r *fakeKindleSendRepository) ClaimManualSend(ctx context.Context, sendID string, now time.Time) (domain.ClaimedKindleSend, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.claimErr != nil {
		return domain.ClaimedKindleSend{}, r.claimErr
	}

	settings, err := r.currentSettingsLocked()
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	if settings.SMTP == nil || settings.Kindle == nil {
		return domain.ClaimedKindleSend{}, domain.NewError(domain.ErrKindleNotConfigured, nil)
	}

	if r.running {
		return domain.ClaimedKindleSend{}, domain.NewError(domain.ErrKindleSendInProgress, nil)
	}

	record := domain.KindleSendRecord{
		ID:        sendID,
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: now,
	}
	r.running = true
	r.created = append(r.created, record)

	return domain.ClaimedKindleSend{
		Claimed: true,
		Record:  record,
		Delivery: domain.KindleDelivery{
			SMTP:        *settings.SMTP,
			KindleEmail: settings.Kindle.KindleEmail,
		},
	}, nil
}

func (r *fakeKindleSendRepository) ClaimDueSend(ctx context.Context, sendID string, now time.Time, loc *time.Location, slotBusy bool) (domain.ClaimedKindleSend, error) {
	r.mu.Lock()
	before := r.beforeClaim
	r.mu.Unlock()

	if before != nil {
		before()
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.claimFailure > 0 {
		r.claimFailure--
		if r.claimErr != nil {
			return domain.ClaimedKindleSend{}, r.claimErr
		}

		return domain.ClaimedKindleSend{}, errors.New("claim failed")
	}

	if r.claimErr != nil {
		return domain.ClaimedKindleSend{}, r.claimErr
	}

	settings, err := r.currentSettingsLocked()
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	if settings.SMTP == nil || settings.Kindle == nil || settings.Kindle.SendTime == nil || settings.Kindle.NextSendAt == nil {
		return domain.ClaimedKindleSend{}, nil
	}

	if settings.Kindle.NextSendAt.After(now) {
		return domain.ClaimedKindleSend{}, nil
	}

	nextSendAt, err := domain.ComputeNextSendAt(*settings.Kindle.SendTime, now, loc)
	if err != nil {
		return domain.ClaimedKindleSend{}, err
	}

	r.advances = append(r.advances, nextSendAt)
	if !r.keepDue && r.settingsRepo != nil {
		_ = r.settingsRepo.UpdateKindle(ctx, domain.KindleSettings{
			KindleEmail: settings.Kindle.KindleEmail,
			SendTime:    settings.Kindle.SendTime,
			NextSendAt:  &nextSendAt,
		})
	}

	// Advance the schedule above, but never insert a running row while another
	// send is persisted as running or the caller's in-process slot is occupied.
	if slotBusy || r.running {
		return domain.ClaimedKindleSend{}, nil
	}

	record := domain.KindleSendRecord{
		ID:        sendID,
		Trigger:   domain.KindleTriggerScheduled,
		Status:    domain.KindleStatusRunning,
		StartedAt: now,
	}
	r.running = true
	r.created = append(r.created, record)

	return domain.ClaimedKindleSend{
		Claimed: true,
		Record:  record,
		Delivery: domain.KindleDelivery{
			SMTP:        *settings.SMTP,
			KindleEmail: settings.Kindle.KindleEmail,
		},
	}, nil
}

func (r *fakeKindleSendRepository) setClaimFailure(count int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.claimFailure = count
	r.claimErr = err
}

func (r *fakeKindleSendRepository) advanceList() []time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]time.Time(nil), r.advances...)
}

func (r *fakeKindleSendRepository) ListUnreadForKindle(ctx context.Context) ([]domain.KindleArticleRef, error) {
	r.mu.Lock()
	onList := r.onList
	r.mu.Unlock()

	if onList != nil {
		onList()
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.listCalls++
	if r.listErr != nil {
		return nil, r.listErr
	}

	refs := make([]domain.KindleArticleRef, 0, len(r.savedPages))
	for _, page := range r.savedPages {
		refs = append(refs, domain.KindleArticleRef{ID: page.ID, IsSavedPage: true})
	}

	for _, feed := range r.feeds {
		for _, item := range r.items[feed.ID] {
			refs = append(refs, domain.KindleArticleRef{ID: item.ID})
		}
	}

	return refs, nil
}

func (r *fakeKindleSendRepository) GetKindleArticle(ctx context.Context, ref domain.KindleArticleRef) (*domain.SavedPage, *domain.Feed, *domain.FeedItem, error) {
	r.mu.Lock()
	onGet := r.onGetArticle
	getErr := r.getErr
	r.mu.Unlock()

	if onGet != nil {
		onGet(ref)
	}

	if getErr != nil {
		return nil, nil, nil, getErr
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if ref.IsSavedPage {
		return r.findSavedPageLocked(ref.ID), nil, nil, nil
	}

	item := r.findFeedItemLocked(ref.ID)
	if item == nil {
		return nil, nil, nil, nil
	}

	feed := r.findFeedLocked(item.FeedID)
	if feed == nil {
		return nil, nil, nil, nil
	}

	return nil, feed, item, nil
}

func (r *fakeKindleSendRepository) findSavedPageLocked(id string) *domain.SavedPage {
	for i := range r.savedPages {
		if r.savedPages[i].ID == id {
			page := r.savedPages[i]

			return &page
		}
	}

	return nil
}

func (r *fakeKindleSendRepository) findFeedItemLocked(id string) *domain.FeedItem {
	for _, feedItems := range r.items {
		for i := range feedItems {
			if feedItems[i].ID == id {
				it := feedItems[i]

				return &it
			}
		}
	}

	return nil
}

func (r *fakeKindleSendRepository) findFeedLocked(id string) *domain.Feed {
	for i := range r.feeds {
		if r.feeds[i].ID == id {
			f := r.feeds[i]

			return &f
		}
	}

	return nil
}

func (r *fakeKindleSendRepository) RecordBookAccepted(ctx context.Context, sendID string, bookIndex int, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	r.mu.Lock()
	onRecord := r.onRecord
	r.mu.Unlock()

	if onRecord != nil {
		onRecord(ctx)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.recordCalls++

	if err := ctx.Err(); err != nil {
		return err
	}

	if r.recordFailure > 0 {
		r.recordFailure--

		if r.recordErr != nil {
			return r.recordErr
		}

		return errors.New("record failed")
	}

	if r.recordErr != nil {
		return r.recordErr
	}

	r.accepted = append(r.accepted, acceptedBook{
		sendID:       sendID,
		bookIndex:    bookIndex,
		savedPageIDs: append([]string(nil), savedPageIDs...),
		feedItemIDs:  append([]string(nil), feedItemIDs...),
		articleDelta: articleDelta,
	})

	return nil
}

func (r *fakeKindleSendRepository) CompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) error {
	hook, onComplete, err := r.completeLocked(ctx, sendID, status, errSummary, finishedAt)
	if onComplete != nil {
		onComplete(err)
	}

	if err != nil {
		return err
	}

	// The terminal status is committed here; the hook pauses the caller before
	// it can release its in-process slot.
	if hook != nil {
		hook()
	}

	return nil
}

func (r *fakeKindleSendRepository) completeLocked(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) (func(), func(error), error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	_, hasDeadline := ctx.Deadline()
	r.completed = append(r.completed, completedSend{
		sendID:      sendID,
		status:      status,
		errSummary:  errSummary,
		finishedAt:  finishedAt,
		ctxErr:      ctx.Err(),
		hasDeadline: hasDeadline,
	})

	r.completeCalls++

	if err := ctx.Err(); err != nil {
		return nil, r.onComplete, err
	}

	if r.completeFailure > 0 {
		r.completeFailure--

		return nil, r.onComplete, errors.New("transient complete failure")
	}

	if r.completeErr != nil {
		return nil, r.onComplete, r.completeErr
	}

	r.running = false

	return r.afterComplete, r.onComplete, nil
}

// hasRunningRow reports whether a send is persisted as running.
func (r *fakeKindleSendRepository) hasRunningRow() bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.running
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

func (r *fakeKindleSendRepository) recordCallsList() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.recordCalls
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
	mu        sync.Mutex
	build     func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error)
	newPacker func(ctx context.Context, dateStr string) (domain.EPUBPacker, error)
	calls     int
	lastCall  buildCall
}

func (b *fakeEPUBBuilder) NewPacker(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
	b.mu.Lock()
	b.calls++
	b.lastCall = buildCall{dateStr: dateStr}
	custom := b.newPacker
	b.mu.Unlock()

	if custom != nil {
		return custom(ctx, dateStr)
	}

	return &fakeEPUBPacker{builder: b, dateStr: dateStr}, nil
}

type fakeEPUBPacker struct {
	builder  *fakeEPUBBuilder
	dateStr  string
	articles []domain.KindleArticle
	books    []domain.EPUBBook
	closed   bool
}

func (p *fakeEPUBPacker) AddArticle(ctx context.Context, article domain.KindleArticle) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	p.articles = append(p.articles, article)
	p.builder.mu.Lock()
	p.builder.lastCall.articles = append(p.builder.lastCall.articles, article)
	p.builder.mu.Unlock()

	return nil
}

func (p *fakeEPUBPacker) Finish(ctx context.Context) (int, error) {
	p.builder.mu.Lock()
	hook := p.builder.build
	p.builder.mu.Unlock()

	if hook == nil {
		return 0, nil
	}

	books, err := hook(ctx, p.dateStr, append([]domain.KindleArticle(nil), p.articles...))
	if err != nil {
		return 0, err
	}

	p.books = append([]domain.EPUBBook(nil), books...)

	return len(p.books), nil
}

func (p *fakeEPUBPacker) ReadBook(ctx context.Context, index int) (domain.EPUBBook, error) {
	if err := ctx.Err(); err != nil {
		return domain.EPUBBook{}, err
	}

	book := p.books[index]
	p.books[index] = domain.EPUBBook{}

	return book, nil
}

func (p *fakeEPUBPacker) Close() error {
	p.closed = true
	p.articles = nil
	p.books = nil

	return nil
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

type boundedStreamPacker struct {
	mu           sync.Mutex
	onAdd        func(id string)
	onFinish     func()
	onRead       func(index int)
	onClose      func()
	liveArticles int
	maxArticles  int
	liveBooks    int
	maxBooks     int
	books        []domain.EPUBBook
	closed       bool
}

func (p *boundedStreamPacker) AddArticle(ctx context.Context, article domain.KindleArticle) error {
	p.mu.Lock()
	p.liveArticles++
	if p.liveArticles > p.maxArticles {
		p.maxArticles = p.liveArticles
	}

	onAdd := p.onAdd
	p.mu.Unlock()

	if onAdd != nil {
		onAdd(article.ID)
	}

	// Simulate streaming packer consuming and discarding the body immediately.
	p.mu.Lock()
	p.liveArticles--
	p.mu.Unlock()

	return nil
}

func (p *boundedStreamPacker) Finish(ctx context.Context) (int, error) {
	p.mu.Lock()
	onFinish := p.onFinish
	n := len(p.books)
	p.mu.Unlock()

	if onFinish != nil {
		onFinish()
	}

	return n, nil
}

func (p *boundedStreamPacker) ReadBook(ctx context.Context, index int) (domain.EPUBBook, error) {
	p.mu.Lock()
	p.liveBooks++
	if p.liveBooks > p.maxBooks {
		p.maxBooks = p.liveBooks
	}

	book := p.books[index]
	p.books[index] = domain.EPUBBook{}
	onRead := p.onRead
	p.mu.Unlock()

	if onRead != nil {
		onRead(index)
	}

	return book, nil
}

func (p *boundedStreamPacker) markBookSent() {
	p.mu.Lock()
	p.liveBooks--
	p.mu.Unlock()
}

func (p *boundedStreamPacker) Close() error {
	p.mu.Lock()
	p.closed = true
	onClose := p.onClose
	p.mu.Unlock()

	if onClose != nil {
		onClose()
	}

	return nil
}
