package httpserver

import (
	"errors"
	"net/http"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestFeedPreview(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.feedFetcher.body = []byte("<rss></rss>")
	h.feedFetcher.finalURL = "https://feeds.example.com/final"
	h.feedParser.parsed = domain.ParsedFeed{
		Title:       "   ",
		Description: strPtr("feed description"),
		Entries: []domain.ParsedFeedEntry{
			{Title: "one"},
			{Title: "two"},
			{Title: "three"},
			{Title: "four"},
		},
	}

	recorder := h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireStatus(t, recorder, http.StatusOK)

	var preview feedPreviewResponse
	decodeBody(t, recorder, &preview)

	if preview.Preview.URL != "https://feeds.example.com/rss" {
		t.Fatalf("preview url = %q", preview.Preview.URL)
	}

	if preview.Preview.Title != "feeds.example.com" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if joined := strings.Join(preview.Preview.Titles, ","); joined != "one,two,three" {
		t.Fatalf("preview titles = %q", joined)
	}

	if preview.Preview.Description == nil || *preview.Preview.Description != "feed description" {
		t.Fatalf("preview description = %v", preview.Preview.Description)
	}

	h.feedParser.parsed = domain.ParsedFeed{Title: "Go Blog", Entries: nil}
	recorder = h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"})
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &preview)

	if preview.Preview.Title != "Go Blog" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if preview.Preview.Titles == nil || len(preview.Preview.Titles) != 0 {
		t.Fatalf("empty titles must serialize as [], got %+v", preview.Preview.Titles)
	}

	if !strings.Contains(recorder.Body.String(), `"titles":[]`) {
		t.Fatalf("empty titles JSON = %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "javascript:alert(1)"}), http.StatusBadRequest, "FeedUrlInvalid")

	h.feedFetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("boom"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FetchFeedError")

	h.feedFetcher.err = nil
	h.feedParser.err = domain.NewError(domain.ErrFeedParserError, errors.New("bad xml"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FeedParserError")
}

func TestFeedSubscribe(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")

	recorder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss", "folderId": folder.ID})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[feedJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("subscribe response has no item")
	}

	if created.Item.Title != "feeds.example.com" {
		t.Fatalf("default title = %q", created.Item.Title)
	}

	if created.Item.ReaderMode != domain.ReaderModeDefault || created.Item.Order != domain.SortOrderNewest {
		t.Fatalf("defaults = %s/%s", created.Item.ReaderMode, created.Item.Order)
	}

	if created.Item.FolderID == nil || *created.Item.FolderID != folder.ID {
		t.Fatalf("folderId = %v", created.Item.FolderID)
	}

	if enqueued := h.refresher.enqueued(); len(enqueued) != 1 || enqueued[0] != created.Item.ID {
		t.Fatalf("refresh enqueue = %+v", h.refresher.batches)
	}

	recorder = h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://second.example.com/rss", "title": "  Go Blog  "})
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Title != "Go Blog" {
		t.Fatalf("explicit title = %q", created.Item.Title)
	}

	duplicate := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireAPIError(t, duplicate, http.StatusConflict, "FeedAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://feeds.example.com/rss" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	missingFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://third.example.com/rss", "folderId": domain.NewID()})
	requireAPIError(t, missingFolder, http.StatusNotFound, "FolderNotFound")

	blankFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://blank-folder.example.com/rss", "folderId": "   "})
	requireAPIError(t, blankFolder, http.StatusNotFound, "FolderNotFound")
	if len(h.allFeeds()) != 2 {
		t.Fatalf("blank folderId subscribe must not create a feed, got %d feeds", len(h.allFeeds()))
	}

	trimmedFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://trimmed-folder.example.com/rss", "folderId": "  " + folder.ID + "  "})
	requireStatus(t, trimmedFolder, http.StatusCreated)
	var trimmedCreated itemResponse[feedJSON]
	decodeBody(t, trimmedFolder, &trimmedCreated)
	if trimmedCreated.Item.FolderID == nil || *trimmedCreated.Item.FolderID != folder.ID {
		t.Fatalf("trimmed folderId = %v, want %q", trimmedCreated.Item.FolderID, folder.ID)
	}

	nullFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://null-folder.example.com/rss", "folderId": nil})
	requireStatus(t, nullFolder, http.StatusCreated)
	var nullCreated itemResponse[feedJSON]
	decodeBody(t, nullFolder, &nullCreated)
	if nullCreated.Item.FolderID != nil {
		t.Fatalf("explicit null folderId = %v, want nil", nullCreated.Item.FolderID)
	}

	invalidURL := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": ""})
	requireAPIError(t, invalidURL, http.StatusBadRequest, "FeedUrlInvalid")
}

func TestFeedPreferencesAndDelete(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "extracted"}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).ReaderMode; got != domain.ReaderModeExtracted {
		t.Fatalf("reader mode = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "bogus"}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "oldest"}), http.StatusNoContent)
	if got := h.feedByID(feed.ID).Order; got != domain.SortOrderOldest {
		t.Fatalf("order = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "bogus"}), http.StatusBadRequest, "RequestFailed")

	for _, tc := range []struct {
		name   string
		body   map[string]any
		status int
		code   string
		folder *string
	}{
		{"move", map[string]any{"folderId": folder.ID}, http.StatusNoContent, "", &folder.ID},
		{"missing", map[string]any{}, http.StatusBadRequest, "RequestFailed", &folder.ID},
		{"mistyped", map[string]any{"folderId": 42}, http.StatusBadRequest, "RequestFailed", &folder.ID},
		{"blank", map[string]any{"folderId": ""}, http.StatusNotFound, "FolderNotFound", &folder.ID},
		{"whitespace", map[string]any{"folderId": "   "}, http.StatusNotFound, "FolderNotFound", &folder.ID},
		{"unknown", map[string]any{"folderId": domain.NewID()}, http.StatusNotFound, "FolderNotFound", &folder.ID},
		{"null", map[string]any{"folderId": nil}, http.StatusNoContent, "", nil},
		{"trimmed", map[string]any{"folderId": "  " + folder.ID + "  "}, http.StatusNoContent, "", &folder.ID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, tc.body)
			if tc.code != "" {
				requireAPIError(t, rec, tc.status, tc.code)
			} else {
				requireStatus(t, rec, tc.status)
			}

			got := h.feedByID(feed.ID).FolderID
			if (got == nil) != (tc.folder == nil) || got != nil && *got != *tc.folder {
				t.Fatalf("folder = %v, want %v", got, tc.folder)
			}
		})
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/refresh", nil), http.StatusAccepted)
	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+domain.NewID()+"/refresh", nil), http.StatusAccepted)
	if batches := h.refresher.batches; len(batches) != 1 || len(batches[0]) != 1 || batches[0][0] != feed.ID {
		t.Fatalf("refresh enqueue = %+v", batches)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/feeds/"+feed.ID, nil), http.StatusNoContent)
	if h.feedByID(feed.ID) != nil {
		t.Fatal("feed was not deleted")
	}
}

func TestFeedItemReadStateAndCounts(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	first := h.seedItem(feed.ID, "https://example.com/1", nil)
	second := h.seedItem(feed.ID, "https://example.com/2", nil)

	recorder := h.authed(http.MethodGet, "/api/feed-items/"+first.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[feedItemJSON]
	decodeBody(t, recorder, &single)
	if single.Item == nil || single.Item.ID != first.ID || single.Item.FeedID != feed.ID {
		t.Fatalf("item = %+v", single.Item)
	}

	recorder = h.authed(http.MethodGet, "/api/feed-items/"+domain.NewID(), nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), `"item":null`) {
		t.Fatalf("unknown item body = %s", recorder.Body.String())
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/unread-counts", nil)
	requireStatus(t, recorder, http.StatusOK)

	var counts listResponse[feedUnreadCountJSON]
	decodeBody(t, recorder, &counts)
	if len(counts.Items) != 1 || counts.Items[0].FeedID != feed.ID || counts.Items[0].Count != 2 {
		t.Fatalf("unread counts = %+v", counts.Items)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+first.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.feedItemByID(first.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read", map[string]any{"ids": []string{second.ID}}), http.StatusNoContent)
	if !h.feedItemByID(second.ID).Read {
		t.Fatal("POST read did not persist")
	}

	scoped := h.seedItem(feed.ID, "https://example.com/scoped", nil)
	otherFeed := h.seedFeed("Other", "https://other.example.com/rss", nil)
	outside := h.seedItem(otherFeed.ID, "https://example.com/outside", nil)
	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", nil), http.StatusNoContent)
	if !h.feedItemByID(scoped.ID).Read || h.feedItemByID(outside.ID).Read {
		t.Fatal("feed read-all did not preserve scope")
	}

	third := h.seedItem(feed.ID, "https://example.com/3", nil)
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read-all", nil), http.StatusNoContent)
	if !h.feedItemByID(third.ID).Read {
		t.Fatal("read-all did not mark items read")
	}
}
