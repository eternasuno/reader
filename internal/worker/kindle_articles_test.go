package worker

import (
	"context"
	"errors"
	"fmt"
	"reader/internal/domain"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

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

	sender := newTestKindleSender(t, KindleConfig{
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
func TestExtractFeedItemContinuesOnCacheWriteError(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	feed := domain.Feed{
		ID:         "feed-1",
		URL:        testURL(t, "https://example.com/feed.xml"),
		Title:      "Feed",
		ReaderMode: domain.ReaderModeExtracted,
		Order:      domain.SortOrderNewest,
	}
	item := domain.FeedItem{
		ID:     "item-1",
		FeedID: "feed-1",
		URL:    testURL(t, "https://example.com/item"),
		Title:  "Item",
	}

	sends := &fakeKindleSendRepository{
		feeds: []domain.Feed{feed},
		items: map[string][]domain.FeedItem{"feed-1": {item}},
	}
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return nil, nil
	}}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		FeedItems:   &fakeFeedItemRepository{saveErr: errors.New("db busy for https://user:secret@example.com/db")},
		Fetcher: &fakeWebpageFetcher{fetch: func(ctx context.Context, url domain.NormalizedURL) (string, string, error) {
			return "<html>", url.Raw(), nil
		}},
		Extractor: &fakeArticleExtractor{extract: func(ctx context.Context, htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
			return domain.ExtractedArticle{Content: "<p>fresh</p>"}, nil
		}},
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	captured := builder.captured()
	if len(captured.articles) != 1 || captured.articles[0].HTMLBody != "<p>fresh</p>" {
		t.Fatalf("articles = %+v, want extracted body despite cache save error", captured.articles)
	}
}

func TestExtractFeedItemKeepsConcurrentWinnerContent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		existing string
		want     string
	}{
		{name: "existing winner is kept", existing: "<p>winner</p>", want: "<p>winner</p>"},
		{name: "blank winner is replaced", existing: " \t\n\u00a0", want: "<p>mine</p>"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			feed := domain.Feed{ID: "feed-1", Title: "Feed", ReaderMode: domain.ReaderModeExtracted, Order: domain.SortOrderNewest}
			// The unread snapshot predates the winner's write, so it carries no extracted content.
			item := domain.FeedItem{ID: "item-1", FeedID: "feed-1", URL: testURL(t, "https://example.com/item"), Title: "Item"}

			sends := &fakeKindleSendRepository{
				feeds: []domain.Feed{feed},
				items: map[string][]domain.FeedItem{"feed-1": {item}},
			}
			feedItems := &fakeFeedItemRepository{extracted: map[string]string{"item-1": tt.existing}}
			builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
				return nil, nil
			}}

			sender := newTestKindleSender(t, KindleConfig{
				KindleSends: sends,
				FeedItems:   feedItems,
				Fetcher: &fakeWebpageFetcher{fetch: func(ctx context.Context, url domain.NormalizedURL) (string, string, error) {
					return "<html>", url.Raw(), nil
				}},
				Extractor: &fakeArticleExtractor{extract: func(ctx context.Context, htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
					return domain.ExtractedArticle{Content: "<p>mine</p>"}, nil
				}},
				EPUBBuilder: builder,
				MailSender:  &fakeMailSender{},
				Now:         func() time.Time { return now },
			})

			if _, err := sender.EnqueueManual(context.Background()); err != nil {
				t.Fatalf("EnqueueManual() error = %v", err)
			}

			sender.Wait()

			captured := builder.captured()
			if len(captured.articles) != 1 || captured.articles[0].HTMLBody != tt.want {
				t.Fatalf("articles = %+v, want a single article with body %q", captured.articles, tt.want)
			}

			if got := feedItems.extractedFor("item-1"); got != tt.want {
				t.Fatalf("persisted extracted content = %q, want %q", got, tt.want)
			}
		})
	}
}
func TestRunJobStreamsArticlesAndBooksWithBoundedLiveState(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	pages := []domain.SavedPage{
		{ID: "page-1", URL: testURL(t, "https://example.com/p1"), Title: "P1", Content: "<p>body1</p>"},
		{ID: "page-2", URL: testURL(t, "https://example.com/p2"), Title: "P2", Content: "<p>body2</p>"},
	}
	feed := domain.Feed{ID: "feed-1", Title: "Feed", Order: domain.SortOrderOldest}
	items := map[string][]domain.FeedItem{
		"feed-1": {
			{ID: "item-1", FeedID: "feed-1", URL: testURL(t, "https://example.com/i1"), Title: "I1", Content: ptrTo("<p>i1</p>")},
			{ID: "item-2", FeedID: "feed-1", URL: testURL(t, "https://example.com/i2"), Title: "I2", Content: ptrTo("<p>i2</p>")},
		},
	}

	var mu sync.Mutex
	var events []string
	liveLoadedArticles := 0
	maxLiveLoadedArticles := 0

	sends := &fakeKindleSendRepository{
		savedPages: pages,
		feeds:      []domain.Feed{feed},
		items:      items,
		onGetArticle: func(ref domain.KindleArticleRef) {
			mu.Lock()
			defer mu.Unlock()
			liveLoadedArticles++
			if liveLoadedArticles > maxLiveLoadedArticles {
				maxLiveLoadedArticles = liveLoadedArticles
			}

			events = append(events, "get:"+ref.ID)
		},
	}

	packer := &boundedStreamPacker{
		books: []domain.EPUBBook{
			{Title: "book-1", Filename: "b1.epub", Data: []byte("b1"), SavedPageIDs: []string{"page-1", "page-2"}, ArticleCount: 2},
			{Title: "book-2", Filename: "b2.epub", Data: []byte("b2"), FeedItemIDs: []string{"item-1", "item-2"}, ArticleCount: 2},
		},
		onAdd: func(id string) {
			mu.Lock()
			defer mu.Unlock()
			events = append(events, "add:"+id)
			liveLoadedArticles--
		},
		onFinish: func() {
			mu.Lock()
			defer mu.Unlock()
			events = append(events, "finish")
		},
		onRead: func(index int) {
			mu.Lock()
			defer mu.Unlock()
			events = append(events, fmt.Sprintf("read:%d", index))
		},
		onClose: func() {
			mu.Lock()
			defer mu.Unlock()
			events = append(events, "close")
		},
	}

	mailer := &fakeMailSender{}
	mailer.send = func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
		mu.Lock()
		events = append(events, "send:"+book.Title)
		mu.Unlock()
		packer.markBookSent()

		return nil
	}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{
			newPacker: func(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
				return packer, nil
			},
		},
		MailSender: mailer,
		Now:        func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if maxLiveLoadedArticles != 1 {
		t.Fatalf("maxLiveLoadedArticles = %d, want 1", maxLiveLoadedArticles)
	}

	if packer.maxArticles != 1 || packer.maxBooks != 1 {
		t.Fatalf("packer peaks = (articles=%d, books=%d), want (1, 1)", packer.maxArticles, packer.maxBooks)
	}

	if !packer.closed {
		t.Fatal("expected packer.Close() to be called")
	}

	wantEvents := []string{
		"get:page-1", "add:page-1",
		"get:page-2", "add:page-2",
		"get:item-1", "add:item-1",
		"get:item-2", "add:item-2",
		"finish",
		"read:0", "send:book-1",
		"read:1", "send:book-2",
		"close",
	}
	if !slices.Equal(events, wantEvents) {
		t.Fatalf("events = %v, want %v", events, wantEvents)
	}
}

func TestRunJobClosesPackerOnFailureAndCancellation(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/p1"), Title: "P1", Content: "body"}

	t.Run("mail failure closes packer", func(t *testing.T) {
		t.Parallel()

		packer := &boundedStreamPacker{
			books: []domain.EPUBBook{{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}},
		}
		mailer := &fakeMailSender{
			send: func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
				return errors.New("smtp down")
			},
		}

		sender := newTestKindleSender(t, KindleConfig{
			KindleSends: &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}},
			EPUBBuilder: &fakeEPUBBuilder{newPacker: func(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
				return packer, nil
			}},
			MailSender: mailer,
			Now:        func() time.Time { return now },
		})

		if _, err := sender.EnqueueManual(context.Background()); err != nil {
			t.Fatalf("EnqueueManual() error = %v", err)
		}

		sender.Wait()

		if !packer.closed {
			t.Fatal("expected packer.Close() after mail failure")
		}
	})

	t.Run("base context cancel closes packer", func(t *testing.T) {
		t.Parallel()

		baseCtx, cancel := context.WithCancel(context.Background())
		packer := &boundedStreamPacker{}
		sends := &fakeKindleSendRepository{
			savedPages: []domain.SavedPage{page},
			onGetArticle: func(ref domain.KindleArticleRef) {
				cancel()
			},
		}

		sender := newTestKindleSender(t, KindleConfig{
			BaseCtx:     baseCtx,
			KindleSends: sends,
			EPUBBuilder: &fakeEPUBBuilder{newPacker: func(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
				return packer, nil
			}},
			MailSender: &fakeMailSender{},
			Now:        func() time.Time { return now },
		})

		if _, err := sender.EnqueueManual(context.Background()); err != nil {
			t.Fatalf("EnqueueManual() error = %v", err)
		}

		sender.Wait()

		if !packer.closed {
			t.Fatal("expected packer.Close() after context cancellation")
		}
	})
}
