package httpserver

import (
	"context"
	"errors"
	"net/http"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestSavedPageCreateAndDuplicate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	published := time.Date(2024, time.May, 1, 12, 0, 0, 0, time.UTC)
	h.webpageFetcher.html = "<html><body><p>hi</p></body></html>"
	h.webpageFetcher.finalURL = "https://example.com/redirected"
	h.extractor.article = domain.ExtractedArticle{
		Title:       "Hello",
		Description: strPtr("desc"),
		Content:     "<p>hi</p>",
		PublishedAt: &published,
	}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": " https://example.com/post?utm_source=news&id=7 "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("created response has no item")
	}

	if created.Item.URL != "https://example.com/post?id=7" {
		t.Fatalf("stored url = %q, want the submitted normalized url", created.Item.URL)
	}

	if created.Item.Title != "Hello" || created.Item.Content != "<p>hi</p>" {
		t.Fatalf("created item = %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "desc" {
		t.Fatalf("created description = %v", created.Item.Description)
	}

	if created.Item.PublishedAt == nil || *created.Item.PublishedAt != "2024-05-01T12:00:00Z" {
		t.Fatalf("created publishedAt = %v", created.Item.PublishedAt)
	}

	if created.Item.Read {
		t.Fatal("a new saved page must be unread")
	}

	if h.webpageFetcher.calls != 1 || h.extractor.calls != 1 {
		t.Fatalf("fetch/extract calls = %d/%d", h.webpageFetcher.calls, h.extractor.calls)
	}

	if h.webpageFetcher.lastURL != "https://example.com/post?id=7" {
		t.Fatalf("fetched url = %q", h.webpageFetcher.lastURL)
	}

	duplicate := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post?id=7&utm_campaign=again"})
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/post?id=7" || conflict.ID != created.Item.ID {
		t.Fatalf("conflict = %+v, want url=%q id=%q", conflict, "https://example.com/post?id=7", created.Item.ID)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatal("duplicate detection must run before fetching the webpage")
	}
}

func TestSavedPageCreateConflictAtInsertReturnsID(t *testing.T) {
	t.Parallel()

	var wrapped *failingSavedPageRepo
	h := newHarnessWith(t, func(cfg *Config) {
		wrapped = &failingSavedPageRepo{SavedPageRepository: cfg.SavedPages, bypassGetByID: true}
		cfg.SavedPages = wrapped
	})

	existing := h.seedSavedPage("https://user:secret@example.com/race", false)
	h.webpageFetcher.html = "<html><body><p>hi</p></body></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Hello", Content: "<p>hi</p>"}

	duplicate := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://user:secret@example.com/race?utm_source=x"})
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.ID != existing.ID {
		t.Fatalf("conflict id = %q, want %q", conflict.ID, existing.ID)
	}

	if conflict.URL != "https://example.com/race" || strings.Contains(duplicate.Body.String(), "secret") {
		t.Fatalf("conflict leaked or mismatched url: %s", duplicate.Body.String())
	}
}

func TestSavedPageRedactsURLCredentials(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.webpageFetcher.html = "<p>private</p>"
	h.extractor.article = domain.ExtractedArticle{Title: "Private", Content: "<p>private</p>"}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://user:supersecret@example.com/private"})
	requireStatus(t, recorder, http.StatusCreated)

	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("response leaked url credentials: %s", recorder.Body.String())
	}

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item.URL != "https://example.com/private" {
		t.Fatalf("url = %q", created.Item.URL)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireStatus(t, recorder, http.StatusOK)
	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("list leaked url credentials: %s", recorder.Body.String())
	}
}

func TestSavedPageValidationAndUpstreamFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		body       map[string]any
		fetchErr   error
		extractErr error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "unsupported scheme",
			body:       map[string]any{"url": "ftp://example.com/file"},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "empty url",
			body:       map[string]any{"url": "   "},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "fetch failure",
			body:       map[string]any{"url": "https://example.com/post"},
			fetchErr:   domain.NewError(domain.ErrWebpageFetcherError, errors.New("dial tcp 10.0.0.1: connect: connection refused")),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "WebpageFetcherError",
		},
		{
			name:       "empty article",
			body:       map[string]any{"url": "https://example.com/post"},
			extractErr: domain.NewError(domain.ErrArticleEmptyContent, nil),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "ArticleEmptyContent",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			h.webpageFetcher.err = testCase.fetchErr
			h.extractor.err = testCase.extractErr

			recorder := h.authed(http.MethodPost, "/api/saved-pages", testCase.body)
			requireAPIError(t, recorder, testCase.wantStatus, testCase.wantCode)

			if strings.Contains(recorder.Body.String(), "10.0.0.1") {
				t.Fatalf("error response leaked the internal cause: %s", recorder.Body.String())
			}

			if pages := h.allSavedPages(); len(pages) != 0 {
				t.Fatalf("failed create persisted %d pages", len(pages))
			}
		})
	}
}

func TestSavedPageGet(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/saved", false)

	byID := h.authed(http.MethodGet, "/api/saved-pages/"+page.ID, nil)
	requireStatus(t, byID, http.StatusOK)

	var fetched itemResponse[savedPageJSON]
	decodeBody(t, byID, &fetched)
	if fetched.Item == nil || fetched.Item.ID != page.ID {
		t.Fatalf("get item = %+v", fetched.Item)
	}

	unknown := h.authed(http.MethodGet, "/api/saved-pages/"+domain.NewID(), nil)
	requireStatus(t, unknown, http.StatusOK)
	decodeBody(t, unknown, &fetched)
	if fetched.Item != nil {
		t.Fatalf("unknown id returned %+v", fetched.Item)
	}
}

func TestSavedPagePagingAndReadState(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	first := h.seedSavedPage("https://example.com/1", false)
	second := h.seedSavedPage("https://example.com/2", false)
	third := h.seedSavedPage("https://example.com/3", false)

	recorder := h.authed(http.MethodGet, "/api/saved-pages?limit=2", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[savedPageJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 || page.Items[0].ID != third.ID || page.Items[1].ID != second.ID {
		t.Fatalf("first page = %+v", page.Items)
	}

	if page.Cursor == nil || *page.Cursor != second.ID {
		t.Fatalf("first page cursor = %v", page.Cursor)
	}

	if !domain.IsValidUUIDv7(page.Boundary) {
		t.Fatalf("first page boundary = %q, want valid UUIDv7", page.Boundary)
	}

	firstBoundary := page.Boundary
	recorder = h.authed(http.MethodGet, "/api/saved-pages?limit=2&cursor="+*page.Cursor+"&boundary="+firstBoundary, nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != first.ID {
		t.Fatalf("second page = %+v", page.Items)
	}

	if page.Cursor != nil || page.Boundary != firstBoundary {
		t.Fatalf("last page cursor=%v boundary=%q, want nil and %q", page.Cursor, page.Boundary, firstBoundary)
	}

	if err := h.db.SavedPages().SetRead(context.Background(), second.ID, true); err != nil {
		t.Fatalf("set saved page read: %v", err)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 {
		t.Fatalf("unread filter returned %d items", len(page.Items))
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread=false", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 3 {
		t.Fatalf("unread=false returned %d items", len(page.Items))
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?unread=maybe", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=0", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=201", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?cursor=not-a-uuid", nil), http.StatusBadRequest, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil)
	requireStatus(t, recorder, http.StatusOK)

	var count countResponse
	decodeBody(t, recorder, &count)
	if count.Count != 2 || !domain.IsValidUUIDv7(count.Boundary) {
		t.Fatalf("unread count = %+v", count)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+third.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.savedByID(third.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read", map[string]any{"ids": []string{first.ID}}), http.StatusNoContent)
	if !h.savedByID(first.ID).Read {
		t.Fatal("POST read did not persist")
	}

	fourth := h.seedSavedPage("https://example.com/4", false)
	requireAPIError(t, h.authed(http.MethodPost, "/api/saved-pages/read-all", nil), http.StatusBadRequest, "RequestFailed")
	if h.savedByID(fourth.ID).Read {
		t.Fatal("bodyless saved-pages read-all changed read state")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read-all", map[string]any{"before": domain.NewID()}), http.StatusNoContent)
	for _, saved := range h.allSavedPages() {
		if !saved.Read {
			t.Fatalf("page %s still unread after read-all", saved.ID)
		}
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/saved-pages/"+second.ID, nil), http.StatusNoContent)

	recorder = h.authed(http.MethodGet, "/api/saved-pages/"+second.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[savedPageJSON]
	decodeBody(t, recorder, &single)
	if single.Item != nil {
		t.Fatal("deleted page is still returned")
	}
}

func TestSavedPageRepositoryErrorsAreSanitized(t *testing.T) {
	t.Parallel()

	repoErr := domain.NewError(domain.ErrSavedPageRepositoryError, errors.New("sqlite: disk I/O error at /data/reader.db"))
	h := newHarnessWith(t, func(cfg *Config) {
		cfg.SavedPages = &failingSavedPageRepo{
			SavedPageRepository: cfg.SavedPages,
			listErr:             repoErr,
			unreadErr:           repoErr,
		}
	})

	recorder := h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireAPIError(t, recorder, http.StatusInternalServerError, "SavedPageRepositoryError")

	if strings.Contains(recorder.Body.String(), "disk I/O error") {
		t.Fatalf("response leaked the internal cause: %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil), http.StatusInternalServerError, "SavedPageRepositoryError")
}

type unreadCountSpySavedPageRepo struct {
	domain.SavedPageRepository
	gotBoundary string
	onUnread    func(boundary string)
}

func (r *unreadCountSpySavedPageRepo) UnreadCount(ctx context.Context, boundary string) (int, error) {
	r.gotBoundary = boundary
	if r.onUnread != nil {
		r.onUnread(boundary)
	}

	return r.SavedPageRepository.UnreadCount(ctx, boundary)
}

func TestSavedPageUnreadCountBoundWithReturnedBoundary(t *testing.T) {
	t.Parallel()

	var spy *unreadCountSpySavedPageRepo
	h := newHarnessWith(t, func(cfg *Config) {
		spy = &unreadCountSpySavedPageRepo{SavedPageRepository: cfg.SavedPages}
		cfg.SavedPages = spy
	})

	h.seedSavedPage("https://example.com/before", false)
	spy.onUnread = func(boundary string) {
		post := h.seedSavedPage("https://example.com/after", false)
		if post.ID <= boundary {
			t.Fatalf("post-boundary page %q <= boundary %q", post.ID, boundary)
		}
	}

	recorder := h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil)
	requireStatus(t, recorder, http.StatusOK)

	var count countResponse
	decodeBody(t, recorder, &count)
	if !domain.IsValidUUIDv7(count.Boundary) || count.Boundary != spy.gotBoundary {
		t.Fatalf("count boundary = %q, repo saw %q", count.Boundary, spy.gotBoundary)
	}

	if count.Count != 1 {
		t.Fatalf("bounded unread count = %d, want 1", count.Count)
	}
}

func TestSavedPageReadAllValidationAndBoundary(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	beforePage := h.seedSavedPage("https://example.com/before", false)
	boundary := domain.NewID()
	afterPage := h.seedSavedPage("https://example.com/after", false)

	invalidID := domain.NewID()
	for _, body := range []string{
		"",
		`{}`,
		`null`,
		`{"before":null}`,
		`{"before":""}`,
		`{"before":"not-a-uuid"}`,
		`{"before":"00000000-0000-4000-8000-000000000000"}`,
		`{"before":"` + strings.ToUpper(invalidID) + `"}`,
		`{"before":"` + invalidID + `","extra":true}`,
		`{"before":"` + invalidID + `"} trailing`,
	} {
		requireAPIError(t, h.do(h.rawRequest(http.MethodPost, "/api/saved-pages/read-all", body)), http.StatusBadRequest, "RequestFailed")
	}

	if h.savedByID(beforePage.ID).Read || h.savedByID(afterPage.ID).Read {
		t.Fatal("invalid saved-pages read-all changed read state")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read-all", map[string]any{"before": boundary}), http.StatusNoContent)
	if !h.savedByID(beforePage.ID).Read || h.savedByID(afterPage.ID).Read {
		t.Fatalf("bounded saved-pages read-all states = (%v, %v), want (true, false)", h.savedByID(beforePage.ID).Read, h.savedByID(afterPage.ID).Read)
	}
}

func TestFeedItemSave(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Feed", "https://feeds.example.com/rss", nil)
	extracted := h.seedItem(feed.ID, "https://example.com/extracted", func(item *domain.FeedItem) {
		item.Title = "Extracted"
		item.Description = strPtr("feed description")
		item.ExtractedContent = strPtr("<p>extracted</p>")
	})
	withContent := h.seedItem(feed.ID, "https://example.com/content", func(item *domain.FeedItem) {
		item.Content = strPtr("<p>content</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", func(item *domain.FeedItem) {
		item.Title = "Bare"
	})
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Fetched", Content: "<p>fetched</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Content != "<p>extracted</p>" {
		t.Fatalf("extracted content was not reused: %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "feed description" {
		t.Fatalf("description = %v", created.Item.Description)
	}

	if created.Item.Read {
		t.Fatal("saved copies must start unread")
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with extracted content must not fetch the webpage")
	}

	duplicate := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/extracted" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+withContent.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>content</p>" {
		t.Fatalf("feed content was not reused: %+v", created.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with feed content must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>fetched</p>" || created.Item.Title != "Fetched" {
		t.Fatalf("fetched save = %+v", created.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("expected one webpage fetch, got %d", h.webpageFetcher.calls)
	}

	missing := h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/save", nil)
	requireAPIError(t, missing, http.StatusNotFound, "FeedItemNotFound")
}
