package httpserver

import (
	"context"
	"net/http"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestReadStateRequiresExplicitFlag(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/page", true)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/item", func(item *domain.FeedItem) { item.Read = true })

	requireAPIError(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")

	if !h.savedByID(page.ID).Read || !h.feedItemByID(item.ID).Read {
		t.Fatal("omitted read flag changed state")
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{"read": true}), http.StatusNoContent)
	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{"read": false}), http.StatusNoContent)
	if h.savedByID(page.ID).Read {
		t.Fatal("explicit read:false did not mark saved page unread")
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{"read": true}), http.StatusNoContent)
	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{"read": false}), http.StatusNoContent)
	if h.feedItemByID(item.ID).Read {
		t.Fatal("explicit read:false did not mark feed item unread")
	}
}

func TestListEndpointsHonorOrder(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	firstItem := h.seedItem(feed.ID, "https://example.com/a", nil)
	secondItem := h.seedItem(feed.ID, "https://example.com/b", nil)
	thirdItem := h.seedItem(feed.ID, "https://example.com/c", nil)
	firstPage := h.seedSavedPage("https://example.com/1", false)
	secondPage := h.seedSavedPage("https://example.com/2", false)

	for _, target := range []string{"/api/feed-items", "/api/folders/" + folder.ID + "/items"} {
		var page pageResponse[feedItemJSON]
		recorder := h.authed(http.MethodGet, target+"?order=oldest&limit=2", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 2 || page.Items[0].ID != firstItem.ID || page.Items[1].ID != secondItem.ID {
			t.Fatalf("%s oldest page = %+v", target, page.Items)
		}

		if page.Cursor == nil || *page.Cursor != secondItem.ID {
			t.Fatalf("%s oldest cursor = %v", target, page.Cursor)
		}

		recorder = h.authed(http.MethodGet, target+"?order=oldest&limit=2&cursor="+*page.Cursor, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 1 || page.Items[0].ID != thirdItem.ID || page.Cursor != nil {
			t.Fatalf("%s oldest continuation = %+v", target, page)
		}

		recorder = h.authed(http.MethodGet, target+"?order=newest", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s explicit newest = %+v", target, page.Items)
		}

		recorder = h.authed(http.MethodGet, target, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s default order = %+v", target, page.Items)
		}

		requireAPIError(t, h.authed(http.MethodGet, target+"?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
	}

	t.Run("feed-specific order", func(t *testing.T) {

		h := newHarness(t)
		oldestFeed := h.seedFeed("Oldest", "https://feeds.example.com/oldest", nil)
		if err := h.db.Feeds().UpdateOrder(context.Background(), oldestFeed.ID, domain.SortOrderOldest); err != nil {
			t.Fatalf("update feed order: %v", err)
		}
		h.seedFeed("Newest", "https://feeds.example.com/newest", nil)

		first := h.seedItem(oldestFeed.ID, "https://example.com/first", nil)
		second := h.seedItem(oldestFeed.ID, "https://example.com/second", nil)

		recorder := h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items", nil)
		requireStatus(t, recorder, http.StatusOK)

		var page pageResponse[feedItemJSON]
		decodeBody(t, recorder, &page)
		if len(page.Items) != 2 || page.Items[0].ID != first.ID || page.Items[1].ID != second.ID {
			t.Fatalf("stored oldest order ignored: %+v", page.Items)
		}

		recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=newest", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if page.Items[0].ID != second.ID || page.Items[1].ID != first.ID {
			t.Fatalf("explicit newest order ignored: %+v", page.Items)
		}

		requireAPIError(t, h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=bogus", nil), http.StatusBadRequest, "RequestFailed")

		recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?limit=1", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 1 || page.Cursor == nil || *page.Cursor != first.ID {
			t.Fatalf("paged feed items = %+v cursor %v", page.Items, page.Cursor)
		}

		recorder = h.authed(http.MethodGet, "/api/feeds/"+domain.NewID()+"/items", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if page.Items == nil || len(page.Items) != 0 || page.Cursor != nil {
			t.Fatalf("unknown feed page = %+v", page)
		}

		if !strings.Contains(recorder.Body.String(), `"items":[]`) {
			t.Fatalf("empty page items must serialize as []: %s", recorder.Body.String())
		}
	})

	var saved pageResponse[savedPageJSON]
	recorder := h.authed(http.MethodGet, "/api/saved-pages?order=oldest", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &saved)
	if len(saved.Items) != 2 || saved.Items[0].ID != firstPage.ID || saved.Items[1].ID != secondPage.ID {
		t.Fatalf("saved pages oldest = %+v", saved.Items)
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
}

func TestPagingQueryValidation(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	item := h.seedItem(feed.ID, "https://example.com/1", nil)
	h.seedSavedPage("https://example.com/page", false)

	endpoints := []string{
		"/api/saved-pages",
		"/api/feed-items",
		"/api/feeds/" + feed.ID + "/items",
		"/api/folders/" + folder.ID + "/items",
	}

	badQueries := []string{
		"?cursor=%ZZ",
		"?limit=10%ZZ",
		"?cursor=",
		"?cursor=%20" + item.ID,
		"?limit=",
		"?limit=abc",
		"?limit=-1",
		"?limit=0",
		"?limit=201",
		"?limit=10&limit=20",
		"?cursor=" + item.ID + "&cursor=" + item.ID,
	}

	for _, endpoint := range endpoints {
		for _, query := range badQueries {
			requireAPIError(t, h.authed(http.MethodGet, endpoint+query, nil), http.StatusBadRequest, "RequestFailed")
		}

		requireStatus(t, h.authed(http.MethodGet, endpoint+"?limit=1", nil), http.StatusOK)
		requireStatus(t, h.authed(http.MethodGet, endpoint+"?limit=200", nil), http.StatusOK)
	}
}

func TestBulkMarkReadRequiresIDsArray(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/page", false)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://example.com/item", nil)

	for _, endpoint := range []string{"/api/saved-pages/read", "/api/feed-items/read"} {
		for _, rawBody := range []string{`{}`, `{"ids":null}`, `null`} {
			requireAPIError(t, h.do(h.rawRequest(http.MethodPost, endpoint, rawBody)), http.StatusBadRequest, "RequestFailed")
		}

		requireStatus(t, h.do(h.rawRequest(http.MethodPost, endpoint, `{"ids":[]}`)), http.StatusNoContent)
	}

	if h.savedByID(page.ID).Read {
		t.Fatal("empty saved-pages read payload must keep page unread")
	}

	if h.feedItemByID(item.ID).Read {
		t.Fatal("empty feed-items read payload must keep item unread")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read", map[string]any{"ids": []string{page.ID}}), http.StatusNoContent)
	if !h.savedByID(page.ID).Read {
		t.Fatal("saved page was not marked read")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read", map[string]any{"ids": []string{item.ID}}), http.StatusNoContent)
	if !h.feedItemByID(item.ID).Read {
		t.Fatal("feed item was not marked read")
	}
}
