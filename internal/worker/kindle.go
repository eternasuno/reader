package worker

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"reader/internal/domain"
)

const (
	defaultKindleTickInterval  = 5 * time.Minute
	kindleDateLayout           = "2006-01-02"
	detachedWriteTimeout       = 5 * time.Second
	defaultCompleteBaseBackoff = 100 * time.Millisecond
	defaultCompleteMaxBackoff  = 30 * time.Second
	maxLoggedErrorBytes        = 256
	completeLogIntervalAttempt = 10
)

type KindleConfig struct {
	BaseCtx      context.Context
	KindleSends  domain.KindleSendRepository
	FeedItems    domain.FeedItemRepository
	Fetcher      domain.WebpageFetcher
	Extractor    domain.ArticleExtractor
	EPUBBuilder  domain.EPUBBuilder
	MailSender   domain.MailSender
	Location     *time.Location
	TickInterval time.Duration
	Now          func() time.Time
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
	loc                 *time.Location
	tickInterval        time.Duration
	now                 func() time.Time
	completeBaseBackoff time.Duration
	completeMaxBackoff  time.Duration

	mu      sync.Mutex
	running bool
	wg      sync.WaitGroup
}

func NewKindleSender(cfg KindleConfig) *KindleSender {
	baseCtx := cfg.BaseCtx
	if baseCtx == nil {
		baseCtx = context.Background()
	}

	loc := cfg.Location
	if loc == nil {
		loc = time.Local
	}

	tickInterval := cfg.TickInterval
	if tickInterval <= 0 {
		tickInterval = defaultKindleTickInterval
	}

	now := cfg.Now
	if now == nil {
		now = time.Now
	}

	return &KindleSender{
		baseCtx:             baseCtx,
		kindleSends:         cfg.KindleSends,
		feedItems:           cfg.FeedItems,
		fetcher:             cfg.Fetcher,
		extractor:           cfg.Extractor,
		epubBuilder:         cfg.EPUBBuilder,
		mailSender:          cfg.MailSender,
		loc:                 loc,
		tickInterval:        tickInterval,
		now:                 now,
		completeBaseBackoff: defaultCompleteBaseBackoff,
		completeMaxBackoff:  defaultCompleteMaxBackoff,
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

// CheckSchedule atomically checks eligibility, advances nextSendAt when due,
// and starts a scheduled send when no other send is active.
func (s *KindleSender) CheckSchedule(ctx context.Context) error {
	s.mu.Lock()
	claimed, err := s.kindleSends.ClaimDueSend(ctx, domain.NewID(), s.now().UTC(), s.loc, s.running)
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
	go s.runJob(claimed.Record.ID, claimed.Delivery)
}

// StartScheduler catches up a missed schedule once and then re-checks on the
// configured tick interval until ctx is canceled.
func (s *KindleSender) StartScheduler(ctx context.Context) {
	s.checkScheduleLogged(ctx)

	ticker := time.NewTicker(s.tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.checkScheduleLogged(ctx)
		}
	}
}

func (s *KindleSender) checkScheduleLogged(ctx context.Context) {
	if err := s.CheckSchedule(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logBoundedError("check kindle schedule failed", err)
	}
}

func (s *KindleSender) runJob(sendID string, snapshot domain.KindleDelivery) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()

		s.wg.Done()
	}()

	ctx := s.baseCtx
	status, sendErr := s.executeJob(ctx, sendID, snapshot)
	s.persistTerminalStatus(ctx, sendID, status, sendErr)
}

func (s *KindleSender) executeJob(ctx context.Context, sendID string, snapshot domain.KindleDelivery) (domain.KindleStatus, error) {
	refs, err := s.kindleSends.ListUnreadForKindle(ctx)
	if err != nil {
		return domain.KindleStatusFailed, err
	}

	if len(refs) == 0 {
		return domain.KindleStatusSucceeded, nil
	}

	if err := s.deliverBooks(ctx, sendID, snapshot, refs); err != nil {
		return domain.KindleStatusFailed, err
	}

	return domain.KindleStatusSucceeded, nil
}

func (s *KindleSender) deliverBooks(ctx context.Context, sendID string, snapshot domain.KindleDelivery, refs []domain.KindleArticleRef) error {
	dateStr := s.now().In(s.loc).Format(kindleDateLayout)

	packer, err := s.epubBuilder.NewPacker(ctx, dateStr)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := packer.Close(); closeErr != nil {
			logBoundedError("close kindle epub packer failed", closeErr, "send_id", sendID)
		}
	}()

	bookCount, err := s.packArticles(ctx, packer, refs)
	if err != nil {
		return err
	}

	return s.sendPackedBooks(ctx, sendID, snapshot, packer, bookCount)
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

		if err := s.recordBookAccepted(ctx, sendID, book); err != nil {
			return err
		}
	}

	return nil
}

func (s *KindleSender) recordBookAccepted(ctx context.Context, sendID string, book domain.EPUBBook) error {
	writeCtx, cancel := detachedWriteContext(ctx)
	defer cancel()

	return s.kindleSends.RecordBookAccepted(writeCtx, sendID, book.SavedPageIDs, book.FeedItemIDs, book.ArticleCount)
}

func (s *KindleSender) loadArticle(ctx context.Context, ref domain.KindleArticleRef) (domain.KindleArticle, bool, error) {
	page, feed, item, err := s.kindleSends.GetKindleArticle(ctx, ref)
	if err != nil {
		return domain.KindleArticle{}, false, err
	}

	if ref.IsSavedPage {
		return savedPageArticle(page)
	}

	return s.feedItemArticle(ctx, feed, item)
}

func savedPageArticle(page *domain.SavedPage) (domain.KindleArticle, bool, error) {
	if page == nil {
		return domain.KindleArticle{}, false, nil
	}

	return domain.KindleArticle{
		ID:          page.ID,
		IsSavedPage: true,
		SourceTitle: page.URL.Host(),
		URL:         page.URL.RedactedString(),
		Title:       page.Title,
		HTMLBody:    page.Content,
		PublishedAt: page.PublishedAt,
	}, true, nil
}

func (s *KindleSender) feedItemArticle(ctx context.Context, feed *domain.Feed, item *domain.FeedItem) (domain.KindleArticle, bool, error) {
	if feed == nil || item == nil {
		return domain.KindleArticle{}, false, nil
	}

	return domain.KindleArticle{
		ID:          item.ID,
		IsSavedPage: false,
		SourceTitle: feed.Title,
		URL:         item.URL.RedactedString(),
		Title:       item.Title,
		HTMLBody:    s.feedItemBody(ctx, *feed, *item),
		PublishedAt: item.PublishedAt,
	}, true, nil
}

// feedItemBody resolves the article HTML per KD-TEXT-1: extracted modes prefer
// cached or freshly extracted content, then fall back to the default content.
func (s *KindleSender) feedItemBody(ctx context.Context, feed domain.Feed, item domain.FeedItem) string {
	if feed.ReaderMode == domain.ReaderModeExtracted || feed.ReaderMode == domain.ReaderModeEmbedded {
		if extracted := s.extractedFeedItemBody(ctx, item); extracted != "" {
			return extracted
		}
	}

	return defaultFeedItemBody(item)
}

func (s *KindleSender) extractedFeedItemBody(ctx context.Context, item domain.FeedItem) string {
	if item.ExtractedContent != nil && strings.TrimSpace(*item.ExtractedContent) != "" {
		return *item.ExtractedContent
	}

	return s.extractFeedItem(ctx, item)
}

func defaultFeedItemBody(item domain.FeedItem) string {
	if item.Content != nil && strings.TrimSpace(*item.Content) != "" {
		return *item.Content
	}

	if item.Description != nil && strings.TrimSpace(*item.Description) != "" {
		return *item.Description
	}

	return ""
}

func (s *KindleSender) extractFeedItem(ctx context.Context, item domain.FeedItem) string {
	if s.fetcher == nil || s.extractor == nil {
		return ""
	}

	htmlBody, finalURL, err := s.fetcher.FetchWebpage(ctx, item.URL)
	if err != nil {
		return ""
	}

	extracted, err := s.extractor.ExtractArticle(htmlBody, finalURL)
	if err != nil || strings.TrimSpace(extracted.Content) == "" {
		return ""
	}

	if s.feedItems != nil {
		stored, _, err := s.feedItems.SaveExtractedContentIfEmpty(ctx, item.ID, extracted.Content)
		if err != nil {
			logBoundedError("save kindle extracted content failed", err, "item_id", item.ID)
		} else if stored != nil && stored.ExtractedContent != nil && strings.TrimSpace(*stored.ExtractedContent) != "" {
			return *stored.ExtractedContent
		}
	}

	return extracted.Content
}

// persistTerminalStatus is the sole owner of terminal status persistence. It
// retries with bounded exponential backoff while ctx lives and makes one
// final detached attempt if ctx was already canceled.
func (s *KindleSender) persistTerminalStatus(ctx context.Context, sendID string, status domain.KindleStatus, sendErr error) {
	summary := sanitizedSummary(sendErr)
	backoff := s.completeBaseBackoff

	for attempt := 1; ; attempt++ {
		wasCanceled := ctx.Err() != nil
		if s.tryCompleteSend(ctx, sendID, status, summary, attempt) {
			return
		}

		if wasCanceled {
			return
		}

		if !sleepWithContext(ctx, backoff) {
			s.tryCompleteSend(ctx, sendID, status, summary, attempt+1)
			return
		}

		backoff = min(backoff*2, s.completeMaxBackoff)
	}
}

func (s *KindleSender) tryCompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, summary *string, attempt int) bool {
	completeCtx, cancel := detachedWriteContext(ctx)
	defer cancel()

	err := s.kindleSends.CompleteSend(completeCtx, sendID, status, summary, s.now().UTC())
	if err == nil {
		return true
	}

	if attempt == 1 || attempt%completeLogIntervalAttempt == 0 {
		logBoundedError("persist kindle send terminal status failed", err, "send_id", sendID, "status", string(status), "attempt", attempt)
	}

	return false
}

func sanitizedSummary(sendErr error) *string {
	if sendErr == nil {
		return nil
	}

	sanitized := domain.SanitizeErrorText(sendErr.Error())

	return &sanitized
}

func detachedWriteContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), detachedWriteTimeout)
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

func logBoundedError(msg string, err error, attrs ...any) {
	args := make([]any, 0, len(attrs)+2)
	args = append(args, attrs...)
	args = append(args, "error", boundedSanitizedError(err))
	slog.Error(msg, args...)
}

func boundedSanitizedError(err error) string {
	if err == nil {
		return ""
	}

	clean := domain.SanitizeErrorText(err.Error())
	if len(clean) <= maxLoggedErrorBytes {
		return clean
	}

	limit := maxLoggedErrorBytes
	for limit > 0 && !utf8.ValidString(clean[:limit]) {
		limit--
	}

	return clean[:limit] + "..."
}
