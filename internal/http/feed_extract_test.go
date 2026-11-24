package httpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reader/internal/domain"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFeedItemExtract(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	cached := h.seedItem(feed.ID, "https://example.com/cached", func(item *domain.FeedItem) {
		item.ExtractedContent = strPtr("<p>cached</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", nil)
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Extracted", Content: "<p>extracted</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+cached.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)

	var extracted itemResponse[feedItemJSON]
	decodeBody(t, recorder, &extracted)
	if extracted.Item == nil || extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>cached</p>" {
		t.Fatalf("cached item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("cached extraction must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &extracted)
	if extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>extracted</p>" {
		t.Fatalf("extracted item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("webpage fetch calls = %d", h.webpageFetcher.calls)
	}

	stored := h.feedItemByID(bare.ID)
	if stored.ExtractedContent == nil || *stored.ExtractedContent != "<p>extracted</p>" {
		t.Fatal("extracted content was not stored")
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/extract", nil), http.StatusNotFound, "FeedItemNotFound")

	h.extractor.err = domain.NewError(domain.ErrArticleExtractorError, errors.New("readability failed"))
	failing := h.seedItem(feed.ID, "https://example.com/failing", nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+failing.ID+"/extract", nil), http.StatusUnprocessableEntity, "ArticleExtractorError")
}

func TestFeedItemExtractCoalescesAndFirstWriterWins(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/race", nil)

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		return "<html></html>", target.Raw(), nil
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Second", Content: "<p>second</p>"}

	var (
		wg  sync.WaitGroup
		rec [2]*httptest.ResponseRecorder
	)
	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec[idx] = h.authed(http.MethodPost, "/api/feed-items/"+item.ID+"/extract", nil)
		}(i)
	}

	<-started
	waitForExtractWaiters(t, h.handler.(*server).extracts, item.ID, 2)

	// Simulate an independent worker winning the race before extract finishes.
	if _, wrote, err := h.db.FeedItems().SaveExtractedContentIfEmpty(context.Background(), item.ID, "<p>first</p>"); err != nil || !wrote {
		t.Fatalf("first writer failed: wrote=%v err=%v", wrote, err)
	}

	close(release)
	wg.Wait()

	for i, r := range rec {
		requireStatus(t, r, http.StatusOK)
		var resp itemResponse[feedItemJSON]
		decodeBody(t, r, &resp)
		if resp.Item == nil || resp.Item.ExtractedContent == nil || *resp.Item.ExtractedContent != "<p>first</p>" {
			t.Fatalf("response %d = %+v, want first-writer content", i, resp.Item)
		}
	}

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if calls != 1 {
		t.Fatalf("webpage fetch calls = %d, want 1 (coalesced)", calls)
	}
}

func TestFeedItemExtractRechecksCacheInGroup(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/reread", nil)
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Extracted", Content: "<p>extracted</p>"}

	secondAtGate := make(chan struct{})
	releaseSecond := make(chan struct{})
	var gateHits atomic.Int32
	h.handler.(*server).extracts.beforeJoin = func(string) {
		if gateHits.Add(1) == 1 {
			close(secondAtGate)
			<-releaseSecond
		}
	}

	secondDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		secondDone <- h.authed(http.MethodPost, "/api/feed-items/"+item.ID+"/extract", nil)
	}()

	<-secondAtGate

	first := h.authed(http.MethodPost, "/api/feed-items/"+item.ID+"/extract", nil)
	requireStatus(t, first, http.StatusOK)

	close(releaseSecond)
	second := <-secondDone
	requireStatus(t, second, http.StatusOK)

	var resp itemResponse[feedItemJSON]
	decodeBody(t, second, &resp)
	if resp.Item == nil || resp.Item.ExtractedContent == nil || *resp.Item.ExtractedContent != "<p>extracted</p>" {
		t.Fatalf("second response = %+v, want cached extracted content", resp.Item)
	}

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if calls != 1 {
		t.Fatalf("webpage fetch calls = %d, want 1", calls)
	}
}

func TestForegroundFetchSemaphoreBoundsConcurrency(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	entered := make(chan struct{}, maxConcurrentForegroundFetches+2)
	release := make(chan struct{})

	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		entered <- struct{}{}
		select {
		case <-release:
			return "<html></html>", target.Raw(), nil
		case <-ctx.Done():
			return "", "", ctx.Err()
		}
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Ok", Content: "<p>ok</p>"}

	var wg sync.WaitGroup
	for i := range maxConcurrentForegroundFetches {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/sem/" + strconv.Itoa(idx)})
			requireStatus(t, rec, http.StatusCreated)
		}(i)
	}

	for range maxConcurrentForegroundFetches {
		<-entered
	}

	// Fifth request is rejected immediately without blocking when all slots are busy.
	requireAPIError(t, h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/sem/overflow"}), http.StatusTooManyRequests, "TooManyRequests")
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://example.com/sem/feed"}), http.StatusTooManyRequests, "TooManyRequests")

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if calls != maxConcurrentForegroundFetches {
		t.Fatalf("fetch calls = %d, want %d", calls, maxConcurrentForegroundFetches)
	}

	close(release)
	wg.Wait()
}

func TestFeedItemExtractAdmissionAndDedupe(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	items := make([]domain.FeedItem, 0, maxConcurrentForegroundFetches+2)
	for i := range maxConcurrentForegroundFetches + 2 {
		items = append(items, h.seedItem(feed.ID, "https://example.com/admit/"+strconv.Itoa(i), nil))
	}

	entered := make(chan struct{}, maxConcurrentForegroundFetches+2)
	release := make(chan struct{})
	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		if strings.HasSuffix(target.Raw(), "/admit/"+strconv.Itoa(maxConcurrentForegroundFetches)) {
			return "<html></html>", target.Raw(), nil
		}

		entered <- struct{}{}
		select {
		case <-release:
			return "<html></html>", target.Raw(), nil
		case <-ctx.Done():
			return "", "", ctx.Err()
		}
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Ok", Content: "<p>ok</p>"}

	cachedItem := items[maxConcurrentForegroundFetches]
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/"+cachedItem.ID+"/extract", nil), http.StatusOK)

	var wg sync.WaitGroup
	for i := range maxConcurrentForegroundFetches {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/"+id+"/extract", nil), http.StatusOK)
		}(items[i].ID)
	}

	for range maxConcurrentForegroundFetches {
		<-entered
	}

	// A cached item is served without a fetch slot; a new uncached item is rejected.
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/"+cachedItem.ID+"/extract", nil), http.StatusOK)

	overflowItem := items[maxConcurrentForegroundFetches+1]
	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+overflowItem.ID+"/extract", nil), http.StatusTooManyRequests, "TooManyRequests")

	// Concurrent request for an already in-flight item still joins the existing job.
	joinedDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		joinedDone <- h.authed(http.MethodPost, "/api/feed-items/"+items[0].ID+"/extract", nil)
	}()

	waitForExtractWaiters(t, h.handler.(*server).extracts, items[0].ID, 2)
	close(release)
	wg.Wait()

	joined := <-joinedDone
	requireStatus(t, joined, http.StatusOK)

	h.webpageFetcher.mu.Lock()
	calls := h.webpageFetcher.calls
	h.webpageFetcher.mu.Unlock()
	if want := maxConcurrentForegroundFetches + 1; calls != want {
		t.Fatalf("fetch calls = %d, want %d (joined request must not fetch again)", calls, want)
	}
}

func TestFeedItemExtractDeadline(t *testing.T) {
	t.Parallel()

	h := newHarnessWith(t, func(cfg *Config) {
		cfg.ForegroundFetchTimeout = 30 * time.Millisecond
	})

	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	slow := h.seedItem(feed.ID, "https://example.com/slow", nil)
	fast := h.seedItem(feed.ID, "https://example.com/fast", nil)

	h.webpageFetcher.fetch = func(ctx context.Context, target domain.NormalizedURL) (string, string, error) {
		if strings.HasSuffix(target.Raw(), "/slow") {
			<-ctx.Done()

			return "", "", domain.NewError(domain.ErrWebpageFetcherError, ctx.Err())
		}

		return "<html></html>", target.Raw(), nil
	}
	h.extractor.article = domain.ExtractedArticle{Title: "Fast", Content: "<p>fast</p>"}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+slow.ID+"/extract", nil), http.StatusUnprocessableEntity, "WebpageFetcherError")
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/"+fast.ID+"/extract", nil), http.StatusOK)
}

func waitForExtractWaiters(t *testing.T, group *extractGroup, id string, want int) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		group.mu.Lock()
		call := group.calls[id]
		joined := call != nil && call.waiters >= want
		group.mu.Unlock()
		if joined {
			return
		}

		select {
		case <-deadline.C:
			t.Fatalf("extract %s did not reach %d waiters", id, want)
		default:
			runtime.Gosched()
		}
	}
}
