package worker

import (
	"context"
	"strings"
	"sync"
	"time"

	"reader/internal/domain"
)

const (
	defaultKindleTickInterval = 5 * time.Minute
	kindleDateLayout          = "2006-01-02"

	completeSendAttempts = 3
	completeSendTimeout  = 5 * time.Second
)

type KindleConfig struct {
	BaseCtx      context.Context
	Settings     domain.SettingRepository
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
// job at a time, using a snapshot of the delivery settings taken on enqueue.
type KindleSender struct {
	baseCtx      context.Context
	settings     domain.SettingRepository
	kindleSends  domain.KindleSendRepository
	feedItems    domain.FeedItemRepository
	fetcher      domain.WebpageFetcher
	extractor    domain.ArticleExtractor
	epubBuilder  domain.EPUBBuilder
	mailSender   domain.MailSender
	loc          *time.Location
	tickInterval time.Duration
	now          func() time.Time

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
		baseCtx:      baseCtx,
		settings:     cfg.Settings,
		kindleSends:  cfg.KindleSends,
		feedItems:    cfg.FeedItems,
		fetcher:      cfg.Fetcher,
		extractor:    cfg.Extractor,
		epubBuilder:  cfg.EPUBBuilder,
		mailSender:   cfg.MailSender,
		loc:          loc,
		tickInterval: tickInterval,
		now:          now,
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

	settings, err := s.settings.Get(ctx)
	if err != nil {
		s.mu.Unlock()
		return domain.KindleSendRecord{}, err
	}

	if !isKindleConfigured(settings.Kindle) {
		s.mu.Unlock()
		return domain.KindleSendRecord{}, domain.NewError(domain.ErrKindleNotConfigured, nil)
	}

	snapshot := cloneKindleSettings(*settings.Kindle)

	rec, err := s.kindleSends.CreateRunning(ctx, domain.KindleSendRecord{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: s.now().UTC(),
	})
	if err != nil {
		s.mu.Unlock()
		return domain.KindleSendRecord{}, err
	}

	s.running = true
	s.wg.Add(1)
	s.mu.Unlock()

	go s.runJob(rec.ID, snapshot)

	return rec, nil
}

// CheckSchedule starts a scheduled send when the stored nextSendAt is due,
// advancing the schedule before the job is handed to the background worker.
func (s *KindleSender) CheckSchedule(ctx context.Context) error {
	settings, err := s.settings.Get(ctx)
	if err != nil {
		return err
	}

	if !isKindleConfigured(settings.Kindle) || settings.Kindle.SendTime == nil || settings.Kindle.NextSendAt == nil {
		return nil
	}

	now := s.now().UTC()
	if settings.Kindle.NextSendAt.After(now) {
		return nil
	}

	nextSendAt, err := domain.ComputeNextSendAt(*settings.Kindle.SendTime, now, s.loc)
	if err != nil {
		return err
	}

	return s.startScheduledJob(ctx, *settings.Kindle, now, nextSendAt)
}

func (s *KindleSender) startScheduledJob(ctx context.Context, kindle domain.KindleSettings, now, nextSendAt time.Time) error {
	// The running flag and the schedule advance are decided under one lock so a
	// manual send cannot slip in between the check and the create.
	s.mu.Lock()

	// A send already in flight keeps this window: the schedule still advances so
	// the next tick does not replay it, and the due run is skipped per KD-SCHED-1.
	if s.running {
		s.mu.Unlock()

		return s.settings.AdvanceNextSendAt(ctx, nextSendAt)
	}

	snapshot := cloneKindleSettings(kindle)

	// Create the running record before advancing the schedule: a failed insert
	// leaves nextSendAt due so the next tick retries instead of losing the run.
	rec, err := s.kindleSends.CreateRunning(ctx, domain.KindleSendRecord{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerScheduled,
		Status:    domain.KindleStatusRunning,
		StartedAt: now,
	})
	if err != nil {
		s.mu.Unlock()

		return err
	}

	if err := s.settings.AdvanceNextSendAt(ctx, nextSendAt); err != nil {
		s.mu.Unlock()

		// Never leave the just-created record behind as a stuck running row.
		s.completeSend(ctx, rec.ID, domain.KindleStatusFailed, err)

		return err
	}

	s.running = true
	s.wg.Add(1)
	s.mu.Unlock()

	go s.runJob(rec.ID, snapshot)

	return nil
}

// StartScheduler catches up a missed schedule once and then re-checks on the
// configured tick interval until ctx is canceled.
func (s *KindleSender) StartScheduler(ctx context.Context) {
	_ = s.CheckSchedule(ctx)

	ticker := time.NewTicker(s.tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.CheckSchedule(ctx)
		}
	}
}

func (s *KindleSender) runJob(sendID string, snapshot domain.KindleSettings) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()

		s.wg.Done()
	}()

	ctx := s.baseCtx

	savedPages, feeds, itemsByFeed, err := s.kindleSends.ListUnreadForKindle(ctx)
	if err != nil {
		s.failSend(ctx, sendID, err)
		return
	}

	articles := s.buildArticles(ctx, savedPages, feeds, itemsByFeed)
	if len(articles) == 0 {
		s.completeSend(ctx, sendID, domain.KindleStatusSucceeded, nil)

		return
	}

	if err := s.deliverBooks(ctx, sendID, snapshot, articles); err != nil {
		s.failSend(ctx, sendID, err)
		return
	}

	s.completeSend(ctx, sendID, domain.KindleStatusSucceeded, nil)
}

func (s *KindleSender) deliverBooks(ctx context.Context, sendID string, snapshot domain.KindleSettings, articles []domain.KindleArticle) error {
	dateStr := s.now().In(s.loc).Format(kindleDateLayout)

	books, err := s.epubBuilder.BuildBooks(ctx, dateStr, articles)
	if err != nil {
		return err
	}

	for _, book := range books {
		if err := s.mailSender.SendEPUB(ctx, snapshot, book); err != nil {
			return err
		}

		if err := s.kindleSends.RecordBookAccepted(ctx, sendID, book.SavedPageIDs, book.FeedItemIDs, book.ArticleCount); err != nil {
			return err
		}
	}

	return nil
}

func (s *KindleSender) buildArticles(ctx context.Context, savedPages []domain.SavedPage, feeds []domain.Feed, itemsByFeed map[string][]domain.FeedItem) []domain.KindleArticle {
	articles := make([]domain.KindleArticle, 0, len(savedPages))

	for _, page := range savedPages {
		articles = append(articles, domain.KindleArticle{
			ID:          page.ID,
			IsSavedPage: true,
			SourceTitle: page.URL.Host(),
			URL:         page.URL.RedactedString(),
			Title:       page.Title,
			HTMLBody:    page.Content,
			PublishedAt: page.PublishedAt,
		})
	}

	for _, feed := range feeds {
		for _, item := range itemsByFeed[feed.ID] {
			articles = append(articles, domain.KindleArticle{
				ID:          item.ID,
				IsSavedPage: false,
				SourceTitle: feed.Title,
				URL:         item.URL.RedactedString(),
				Title:       item.Title,
				HTMLBody:    s.feedItemBody(ctx, feed, item),
				PublishedAt: item.PublishedAt,
			})
		}
	}

	return articles
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

	_, _ = s.feedItems.SaveExtractedContent(ctx, item.ID, extracted.Content)

	return extracted.Content
}

func (s *KindleSender) failSend(ctx context.Context, sendID string, err error) {
	s.completeSend(ctx, sendID, domain.KindleStatusFailed, err)
}

// completeSend writes the terminal send status on a context detached from the
// job's cancellation and retries a bounded number of times so a canceled job or
// a single transient error cannot leave a permanently stuck running row.
func (s *KindleSender) completeSend(ctx context.Context, sendID string, status domain.KindleStatus, sendErr error) {
	completeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), completeSendTimeout)
	defer cancel()

	var summary *string
	if sendErr != nil {
		sanitized := domain.SanitizeErrorText(sendErr.Error())
		summary = &sanitized
	}

	for range completeSendAttempts {
		if err := s.kindleSends.CompleteSend(completeCtx, sendID, status, summary, s.now().UTC()); err == nil {
			return
		}
	}
}

func isKindleConfigured(k *domain.KindleSettings) bool {
	return k != nil &&
		strings.TrimSpace(k.KindleEmail) != "" &&
		strings.TrimSpace(k.SenderEmail) != "" &&
		strings.TrimSpace(k.SMTPHost) != "" &&
		k.SMTPPort >= 1 &&
		k.SMTPPort <= 65535
}

// cloneKindleSettings deep-copies a delivery configuration so later settings
// updates never mutate an accepted job.
func cloneKindleSettings(k domain.KindleSettings) domain.KindleSettings {
	cloned := k
	cloned.SMTPUser = cloneString(k.SMTPUser)
	cloned.SMTPPassword = cloneString(k.SMTPPassword)
	cloned.SendTime = cloneString(k.SendTime)

	if k.NextSendAt != nil {
		next := *k.NextSendAt
		cloned.NextSendAt = &next
	}

	return cloned
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}

	cloned := *value

	return &cloned
}
