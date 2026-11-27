package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"reader/internal/domain"
)

const (
	defaultKindleTickInterval  = time.Minute
	kindleDateLayout           = "2006-01-02"
	detachedWriteTimeout       = 5 * time.Second
	recordAcceptedTimeout      = 15 * time.Second
	defaultCompleteRetryBudget = 15 * time.Second
	defaultCompleteBaseBackoff = 100 * time.Millisecond
	recordAcceptedMaxAttempts  = 3
	defaultRecordBaseBackoff   = 50 * time.Millisecond
)

type KindleConfig struct {
	BaseCtx      context.Context
	KindleSends  domain.KindleSendRepository
	FeedItems    domain.FeedItemRepository
	Fetcher      domain.WebpageFetcher
	Extractor    domain.ArticleExtractor
	EPUBBuilder  domain.EPUBBuilder
	MailSender   domain.MailSender
	TickInterval time.Duration
	Now          func() time.Time
	OnFatal      func(error)
}

// KindleSender delivers unread articles as EPUB mail from a single background
// job at a time, using a snapshot of the delivery settings claimed atomically.
type KindleSender struct {
	baseCtx             context.Context
	kindleSends         domain.KindleSendRepository
	feedItems           domain.FeedItemRepository
	fetcher             domain.WebpageFetcher
	extractor           domain.ArticleExtractor
	epubBuilder         domain.EPUBBuilder
	mailSender          domain.MailSender
	tickInterval        time.Duration
	now                 func() time.Time
	onFatal             func(error)
	completeBaseBackoff time.Duration
	completeRetryBudget time.Duration
	recordBaseBackoff   time.Duration
	scheduleFailures    atomic.Int32

	mu      sync.Mutex
	running bool
	wg      sync.WaitGroup
}

func NewKindleSender(cfg KindleConfig) *KindleSender {
	tickInterval := cfg.TickInterval
	if tickInterval <= 0 {
		tickInterval = defaultKindleTickInterval
	}

	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	return &KindleSender{
		baseCtx:             cfg.BaseCtx,
		kindleSends:         cfg.KindleSends,
		feedItems:           cfg.FeedItems,
		fetcher:             cfg.Fetcher,
		extractor:           cfg.Extractor,
		epubBuilder:         cfg.EPUBBuilder,
		mailSender:          cfg.MailSender,
		tickInterval:        tickInterval,
		now:                 now,
		onFatal:             cfg.OnFatal,
		completeBaseBackoff: defaultCompleteBaseBackoff,
		completeRetryBudget: defaultCompleteRetryBudget,
		recordBaseBackoff:   defaultRecordBaseBackoff,
	}
}

func (s *KindleSender) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.running
}

// Wait blocks until every background send started so far has finished.
func (s *KindleSender) Wait() {
	s.wg.Wait()
}

func (s *KindleSender) EnqueueManual(ctx context.Context) (domain.KindleSendRecord, error) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()

		return domain.KindleSendRecord{}, domain.NewError(domain.ErrKindleSendInProgress, nil)
	}

	claimed, err := s.kindleSends.ClaimManualSend(ctx, domain.NewID(), s.now().UTC())
	if err != nil {
		s.mu.Unlock()

		return domain.KindleSendRecord{}, err
	}

	s.startClaimedLocked(claimed)
	s.mu.Unlock()

	return claimed.Record, nil
}

// CheckSchedule atomically claims a scheduled send when the stored next send
// time has passed and no other send is active; a busy slot leaves the schedule
// due for a later tick.
func (s *KindleSender) CheckSchedule(ctx context.Context) error {
	s.mu.Lock()
	claimed, err := s.kindleSends.ClaimDueSend(ctx, domain.NewID(), s.now().UTC(), s.running)
	if err != nil || !claimed.Claimed {
		s.mu.Unlock()

		return err
	}

	s.startClaimedLocked(claimed)
	s.mu.Unlock()

	return nil
}

func (s *KindleSender) startClaimedLocked(claimed domain.ClaimedKindleSend) {
	s.running = true
	s.wg.Add(1)
	go s.runJob(claimed)
}

// StartScheduler catches up a missed schedule once and then re-checks on the
// configured tick interval until ctx is canceled.
func (s *KindleSender) StartScheduler(ctx context.Context) {
	s.checkScheduleLogged(ctx)

	tickLoop(ctx, s.tickInterval, s.checkScheduleLogged)
}

func (s *KindleSender) checkScheduleLogged(ctx context.Context) {
	err := s.CheckSchedule(ctx)
	if err == nil {
		s.scheduleFailures.Store(0)

		return
	}

	if isCanceled(ctx, err) {
		return
	}

	logFailure(slog.LevelError, "check kindle schedule failed", err)

	if !isDatabaseError(err) {
		return
	}

	if s.scheduleFailures.Add(1) == fatalFailureStreak {
		s.onFatal(fmt.Errorf("check kindle schedule failed %d consecutive times: %w", fatalFailureStreak, sanitizedError{cause: err}))
	}
}

func (s *KindleSender) runJob(claimed domain.ClaimedKindleSend) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()

		s.wg.Done()
	}()

	ctx := s.baseCtx
	sendErr := s.executeJob(ctx, claimed)
	status := domain.KindleStatusSucceeded
	if sendErr != nil {
		status = domain.KindleStatusFailed
	}

	s.persistTerminalStatus(ctx, claimed.Record.ID, status, sendErr, s.now().UTC())
}

func (s *KindleSender) executeJob(ctx context.Context, claimed domain.ClaimedKindleSend) error {
	refs, err := s.kindleSends.ListUnreadForKindle(ctx)
	if err != nil {
		return err
	}

	if len(refs) == 0 {
		return nil
	}

	return s.deliverBooks(ctx, claimed, refs)
}

func (s *KindleSender) deliverBooks(ctx context.Context, claimed domain.ClaimedKindleSend, refs []domain.KindleArticleRef) error {
	sendID := claimed.Record.ID

	packer, err := s.epubBuilder.NewPacker(ctx, bookDate(claimed))
	if err != nil {
		return err
	}

	defer func() {
		if closeErr := packer.Close(); closeErr != nil {
			logFailure(slog.LevelError, "close kindle epub packer failed", closeErr, "send_id", sendID)
		}
	}()

	bookCount, err := s.packArticles(ctx, packer, refs)
	if err != nil {
		return err
	}

	return s.sendPackedBooks(ctx, sendID, claimed.Delivery, packer, bookCount)
}

// bookDate is the schedule-local date of the occurrence a scheduled send was
// claimed for, independent of when the job runs; manual sends carry no date.
func bookDate(claimed domain.ClaimedKindleSend) string {
	if claimed.ScheduleLocation == nil {
		return ""
	}

	return claimed.ScheduledFor.In(claimed.ScheduleLocation).Format(kindleDateLayout)
}

func (s *KindleSender) packArticles(ctx context.Context, packer domain.EPUBPacker, refs []domain.KindleArticleRef) (int, error) {
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return 0, err
		}

		article, ok, err := s.loadArticle(ctx, ref)
		if err != nil {
			return 0, err
		}

		if !ok {
			continue
		}

		if err := packer.AddArticle(ctx, article); err != nil {
			return 0, err
		}
	}

	return packer.Finish(ctx)
}

func (s *KindleSender) sendPackedBooks(
	ctx context.Context,
	sendID string,
	snapshot domain.KindleDelivery,
	packer domain.EPUBPacker,
	bookCount int,
) error {
	for i := range bookCount {
		if err := ctx.Err(); err != nil {
			return err
		}

		book, err := packer.ReadBook(ctx, i)
		if err != nil {
			return err
		}

		if err := s.mailSender.SendEPUB(ctx, snapshot, book); err != nil {
			return err
		}

		if err := s.recordBookAccepted(ctx, sendID, i, book); err != nil {
			return err
		}
	}

	return nil
}

func (s *KindleSender) recordBookAccepted(ctx context.Context, sendID string, bookIndex int, book domain.EPUBBook) error {
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordAcceptedTimeout)
	defer cancel()

	backoff := s.recordBaseBackoff
	var err error
	for attempt := 1; attempt <= recordAcceptedMaxAttempts; attempt++ {
		err = s.kindleSends.RecordBookAccepted(writeCtx, sendID, bookIndex, book.SavedPageIDs, book.FeedItemIDs, book.ArticleCount)
		if err == nil {
			return nil
		}

		logFailure(slog.LevelWarn, "record kindle book accepted failed", err, "send_id", sendID, "book_index", bookIndex, "attempt", attempt)
		if errors.Is(err, domain.ErrKindleSendNotFound) {
			return err
		}

		if attempt == recordAcceptedMaxAttempts || !sleepWithContext(writeCtx, backoff) {
			break
		}

		backoff *= 2
	}

	if ctx.Err() == nil {
		s.onFatal(fmt.Errorf("record kindle book accepted send_id=%s book_index=%d: %w", sendID, bookIndex, sanitizedError{cause: err}))
	}

	return err
}

func (s *KindleSender) loadArticle(ctx context.Context, ref domain.KindleArticleRef) (domain.KindleArticle, bool, error) {
	page, feed, item, err := s.kindleSends.GetKindleArticle(ctx, ref)
	if err != nil {
		return domain.KindleArticle{}, false, err
	}

	if ref.IsSavedPage {
		article, ok := savedPageArticle(page)

		return article, ok, nil
	}

	article, ok := s.feedItemArticle(ctx, feed, item)

	return article, ok, nil
}

func savedPageArticle(page *domain.SavedPage) (domain.KindleArticle, bool) {
	if page == nil {
		return domain.KindleArticle{}, false
	}

	return domain.KindleArticle{
		ID:          page.ID,
		IsSavedPage: true,
		SourceTitle: page.URL.Host(),
		URL:         page.URL.RedactedString(),
		Title:       page.Title,
		HTMLBody:    page.Content,
		PublishedAt: page.PublishedAt,
	}, true
}

func (s *KindleSender) feedItemArticle(ctx context.Context, feed *domain.Feed, item *domain.FeedItem) (domain.KindleArticle, bool) {
	if feed == nil || item == nil {
		return domain.KindleArticle{}, false
	}

	return domain.KindleArticle{
		ID:          item.ID,
		IsSavedPage: false,
		SourceTitle: feed.Title,
		URL:         item.URL.RedactedString(),
		Title:       item.Title,
		HTMLBody:    s.feedItemBody(ctx, *feed, *item),
		PublishedAt: item.PublishedAt,
	}, true
}

// feedItemBody resolves the article HTML per KD-TEXT-1: the extracted mode prefers
// cached or freshly extracted content, then fall back to the default content.
func (s *KindleSender) feedItemBody(ctx context.Context, feed domain.Feed, item domain.FeedItem) string {
	if feed.ReaderMode == domain.ReaderModeExtracted {
		if extracted := s.extractedFeedItemBody(ctx, item); extracted != "" {
			return extracted
		}
	}

	return defaultFeedItemBody(item)
}

func (s *KindleSender) extractedFeedItemBody(ctx context.Context, item domain.FeedItem) string {
	if item.ExtractedContent != nil {
		return *item.ExtractedContent
	}

	return s.extractFeedItem(ctx, item)
}

func defaultFeedItemBody(item domain.FeedItem) string {
	if item.Content != nil {
		return *item.Content
	}

	if item.Description != nil {
		return *item.Description
	}

	return ""
}

func (s *KindleSender) extractFeedItem(ctx context.Context, item domain.FeedItem) string {
	htmlBody, finalURL, err := s.fetcher.FetchWebpage(ctx, item.URL)
	if err != nil {
		return ""
	}

	extracted, err := s.extractor.ExtractArticle(htmlBody, finalURL)
	if err != nil || strings.TrimSpace(extracted.Content) == "" {
		return ""
	}

	stored, _, err := s.feedItems.SaveExtractedContentIfEmpty(ctx, item.ID, extracted.Content)
	if err != nil {
		logFailure(slog.LevelError, "save kindle extracted content failed", err, "item_id", item.ID)
	} else if stored != nil && stored.ExtractedContent != nil {
		return *stored.ExtractedContent
	}

	return extracted.Content
}

// persistTerminalStatus persists the terminal send status in one bounded
// retry round. When the round exhausts its budget while ctx is still live, it
// calls onFatal so the process exits non-zero. Missing send records are logged
// and treated as done. On shutdown it makes at most one detached write attempt
// and returns without calling onFatal (startup marks leftovers failed).
func (s *KindleSender) persistTerminalStatus(ctx context.Context, sendID string, status domain.KindleStatus, sendErr error, finishedAt time.Time) {
	summary := sanitizedSummary(sendErr)
	budgetCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.completeRetryBudget)
	defer cancel()

	backoff := s.completeBaseBackoff
	var lastErr error

	for attempt, wasCanceled := 1, false; !wasCanceled; attempt++ {
		wasCanceled = ctx.Err() != nil
		err := s.tryCompleteSend(budgetCtx, sendID, status, summary, finishedAt, attempt)
		if err == nil {
			return
		}

		if lastErr == nil || budgetCtx.Err() == nil || !errors.Is(err, context.DeadlineExceeded) {
			lastErr = err
		}

		if !sleepUntilShutdownOrBudget(ctx, budgetCtx, backoff) && budgetCtx.Err() != nil {
			break
		}

		backoff *= 2
	}

	if ctx.Err() == nil {
		s.onFatal(fmt.Errorf("persist kindle send terminal status send_id=%s status=%s: %w", sendID, status, sanitizedError{cause: lastErr}))
	}
}

func (s *KindleSender) tryCompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, summary *string, finishedAt time.Time, attempt int) error {
	completeCtx, cancel := context.WithTimeout(ctx, detachedWriteTimeout)
	defer cancel()

	err := s.kindleSends.CompleteSend(completeCtx, sendID, status, summary, finishedAt)
	if err == nil {
		return nil
	}

	if errors.Is(err, domain.ErrKindleSendNotFound) {
		slog.Error("kindle send missing during terminal status update", "send_id", sendID)

		return nil
	}

	logFailure(slog.LevelError, "persist kindle send terminal status failed", err, "send_id", sendID, "status", string(status), "attempt", attempt)

	return err
}

type sanitizedError struct {
	cause error
}

func (e sanitizedError) Error() string {
	return boundedLogError(e.cause)
}

func (e sanitizedError) Unwrap() error {
	return e.cause
}

func sleepUntilShutdownOrBudget(ctx context.Context, budgetCtx context.Context, delay time.Duration) bool {
	waitCtx, cancel := context.WithCancel(budgetCtx)
	defer cancel()
	stop := context.AfterFunc(ctx, cancel)
	defer stop()

	return sleepWithContext(waitCtx, delay)
}

func sleepWithContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func sanitizedSummary(sendErr error) *string {
	if sendErr == nil {
		return nil
	}

	sanitized := domain.SanitizeErrorText(sendErr.Error())

	return &sanitized
}
