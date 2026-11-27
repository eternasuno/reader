package httpserver

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"reader/internal/domain"
)

func TestWaitExtractionsTracksAbandonedCalls(t *testing.T) {
	group := newExtractGroup(newSlotSemaphore(2), time.Minute)
	s := &Server{extracts: group}
	started := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	finished := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer close(finished)
		_, _ = group.do(ctx, "item", func(context.Context) (*domain.FeedItem, error) {
			close(started)
			<-release

			return nil, nil
		})
	}()
	<-started
	cancel()
	<-finished

	waitCtx, waitCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer waitCancel()

	start := time.Now()
	if err := s.WaitExtractions(waitCtx); !errors.Is(err, context.DeadlineExceeded) || !errors.Is(err, errExtractionsStillRunning) {
		t.Fatalf("WaitExtractions = %v, want deadline exceeded and still running", err)
	}

	if elapsed := time.Since(start); elapsed >= 100*time.Millisecond {
		t.Fatalf("WaitExtractions took %v, expected single-deadline cap below 100ms", elapsed)
	}

	_, err := group.do(context.Background(), "new", func(context.Context) (*domain.FeedItem, error) {
		t.Error("extraction admitted after shutdown")

		return nil, nil
	})
	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) || domainErr.Code != domain.ErrTooManyRequests {
		t.Errorf("admission error = %v, want TooManyRequests", err)
	}

	close(release)
	if err := s.WaitExtractions(context.Background()); err != nil {
		t.Fatalf("WaitExtractions after release: %v", err)
	}
}

type countingExtractionRepo struct {
	domain.FeedItemRepository
	saves atomic.Int32
}

func (r *countingExtractionRepo) SaveExtractedContentIfEmpty(ctx context.Context, id, content string) (*domain.FeedItem, bool, error) {
	r.saves.Add(1)

	return r.FeedItemRepository.SaveExtractedContentIfEmpty(ctx, id, content)
}

func TestWaitExtractionsCancelsFetchWithoutSaving(t *testing.T) {
	h := newHarness(t)
	feed := h.seedFeed("Feed", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/item", nil)
	s := h.handler.(*server)
	repo := &countingExtractionRepo{FeedItemRepository: s.cfg.FeedItems}
	s.cfg.FeedItems = repo
	started := make(chan struct{})
	h.extractor.beforeExtract = func(ctx context.Context, target domain.NormalizedURL) error {
		close(started)
		<-ctx.Done()

		return nil
	}
	h.extractor.article = domain.ExtractedArticle{Content: "<p>content</p>"}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = s.extracts.do(context.Background(), item.ID, func(ctx context.Context) (*domain.FeedItem, error) {
			return s.extractFeedItem(ctx, item.ID)
		})
	}()
	<-started

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.WaitExtractions(ctx); err != nil {
		t.Fatalf("WaitExtractions = %v, want nil", err)
	}

	<-finished
	if got := repo.saves.Load(); got != 0 {
		t.Fatalf("save calls = %d, want 0", got)
	}
}

func TestWaitExtractionsReportsUncooperativeCall(t *testing.T) {
	group := newExtractGroup(newSlotSemaphore(1), time.Minute)
	s := &Server{extracts: group}
	started := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = group.do(context.Background(), "item", func(context.Context) (*domain.FeedItem, error) {
			close(started)
			<-release

			return nil, nil
		})
	}()
	<-started

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := s.WaitExtractions(ctx)
	if !errors.Is(err, context.Canceled) || !errors.Is(err, errExtractionsStillRunning) {
		t.Fatalf("WaitExtractions = %v, want canceled and still running", err)
	}

	close(release)
	<-finished
	if err := s.WaitExtractions(context.Background()); err != nil {
		t.Fatalf("WaitExtractions after release: %v", err)
	}
}
