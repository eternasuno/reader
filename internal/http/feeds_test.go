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

	if wakes := h.refresher.wakeCount(); wakes != 1 {
		t.Fatalf("refresher wakes after subscribe = %d, want 1", wakes)
	}

	if claimed := h.claimDueFeed(); claimed == nil || claimed.ID != created.Item.ID {
		t.Fatalf("claimed feed = %+v, want the new subscription %s due immediately", claimed, created.Item.ID)
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

func TestFeedSubscribeAtCapacity(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.seedFeed("Existing", "https://existing.example.com/rss", nil)
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 10000}), http.StatusNoContent)

	duplicate := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://existing.example.com/rss"})
	requireAPIError(t, duplicate, http.StatusConflict, "FeedAlreadyExists")

	missingFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://new.example.com/rss", "folderId": domain.NewID()})
	requireAPIError(t, missingFolder, http.StatusNotFound, "FolderNotFound")

	response := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://new.example.com/rss"})
	requireAPIError(t, response, http.StatusBadRequest, "FeedItemBudgetExceeded")

	if feeds := h.allFeeds(); len(feeds) != 1 {
		t.Fatalf("feeds after rejected subscribe = %d, want 1", len(feeds))
	}
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

	requireStatus(t, h.authed(http.MethodDelete, "/api/feeds/"+feed.ID, nil), http.StatusNoContent)
	if h.feedByID(feed.ID) != nil {
		t.Fatal("feed was not deleted")
	}
}

func TestFeedManualRefreshMakesFeedDueAndWakesWorkers(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	h.succeedRefresh(feed.ID, domain.FeedSyncMeta{Title: feed.Title}, h.clock.Now())

	if claimed := h.claimDueFeed(); claimed != nil {
		t.Fatalf("feed refreshed a moment ago must not be due, claimed %+v", claimed)
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/refresh", nil), http.StatusAccepted)

	if wakes := h.refresher.wakeCount(); wakes != 1 {
		t.Fatalf("refresher wakes after manual refresh = %d, want 1", wakes)
	}

	if claimed := h.claimDueFeed(); claimed == nil || claimed.ID != feed.ID {
		t.Fatalf("claimed feed = %+v, want %s due after the manual refresh", claimed, feed.ID)
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+domain.NewID()+"/refresh", nil), http.StatusAccepted)
}

func TestFeedItemBatchRequestOrderAndMissingIDs(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	first := h.seedItem(feed.ID, "https://user:secret@example.com/first", func(item *domain.FeedItem) { item.Read = true })
	second := h.seedItem(feed.ID, "https://example.com/second", nil)

	recorder := h.authed(http.MethodGet, "/api/feed-items?ids="+first.ID+","+domain.NewID()+","+second.ID, nil)
	requireStatus(t, recorder, http.StatusOK)
	var batch listResponse[feedItemJSON]
	decodeBody(t, recorder, &batch)
	if len(batch.Items) != 2 || batch.Items[0].ID != first.ID || batch.Items[1].ID != second.ID {
		t.Fatalf("batch = %s, want first and second in request order", recorder.Body.String())
	}

	if batch.Items[0].URL != "https://example.com/first" || batch.Items[0].FeedID != feed.ID || !batch.Items[0].Read {
		t.Fatalf("first item fields = %+v", batch.Items[0])
	}
}

type failingFeedItemRepo struct {
	domain.FeedItemRepository
	err error
}

func (r *failingFeedItemRepo) SnapshotAll(context.Context, domain.SnapshotParams) ([]domain.FeedItemGroup, error) {
	return nil, r.err
}

func (r *failingFeedItemRepo) GetByIDs(context.Context, []string) ([]domain.FeedItem, error) {
	return nil, r.err
}

func TestFeedItemRepositoryErrorsAreSanitized(t *testing.T) {
	t.Parallel()

	h := newHarnessWith(t, func(cfg *Config) {
		cfg.FeedItems = &failingFeedItemRepo{
			FeedItemRepository: cfg.FeedItems,
			err:                domain.NewError(domain.ErrFeedItemRepositoryError, errors.New("sqlite: disk I/O error at /data/reader.db")),
		}
	})

	for _, target := range []string{"/api/feed-items/order", "/api/feed-items?ids=" + domain.NewID()} {
		recorder := h.authed(http.MethodGet, target, nil)
		requireAPIError(t, recorder, http.StatusInternalServerError, "FeedItemRepositoryError")
		if strings.TrimSpace(recorder.Body.String()) != `{"error":"FeedItemRepositoryError"}` {
			t.Fatalf("unexpected error payload: %s", recorder.Body.String())
		}
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

	var counts unreadCountsResponse
	decodeBody(t, recorder, &counts)
	if len(counts.Items) != 1 || counts.Items[0].FeedID != feed.ID || counts.Items[0].Count != 2 {
		t.Fatalf("unread counts = %+v", counts.Items)
	}

	if !domain.IsValidUUIDv7(counts.Boundary) {
		t.Fatalf("unread counts boundary = %q, want valid UUIDv7", counts.Boundary)
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
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", nil), http.StatusBadRequest, "RequestFailed")
	if h.feedItemByID(scoped.ID).Read {
		t.Fatal("bodyless feed read-all changed read state")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", map[string]any{"before": domain.NewID()}), http.StatusNoContent)
	if !h.feedItemByID(scoped.ID).Read || h.feedItemByID(outside.ID).Read {
		t.Fatal("feed read-all did not preserve scope")
	}

	third := h.seedItem(feed.ID, "https://example.com/3", nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/read-all", nil), http.StatusBadRequest, "RequestFailed")
	if h.feedItemByID(third.ID).Read {
		t.Fatal("bodyless feed-items read-all changed read state")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read-all", map[string]any{"before": domain.NewID()}), http.StatusNoContent)
	if !h.feedItemByID(third.ID).Read {
		t.Fatal("read-all did not mark items read")
	}
}

type unreadCountsSpyFeedItemRepo struct {
	domain.FeedItemRepository
	gotBoundary string
	onUnread    func(boundary string)
}

func (r *unreadCountsSpyFeedItemRepo) UnreadCounts(ctx context.Context, boundary string) ([]domain.FeedUnreadCount, error) {
	r.gotBoundary = boundary
	if r.onUnread != nil {
		r.onUnread(boundary)
	}

	return r.FeedItemRepository.UnreadCounts(ctx, boundary)
}

func TestFeedUnreadCountsBoundWithReturnedBoundary(t *testing.T) {
	t.Parallel()

	var spy *unreadCountsSpyFeedItemRepo
	h := newHarnessWith(t, func(cfg *Config) {
		spy = &unreadCountsSpyFeedItemRepo{FeedItemRepository: cfg.FeedItems}
		cfg.FeedItems = spy
	})

	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	h.seedItem(feed.ID, "https://example.com/before", nil)
	spy.onUnread = func(boundary string) {
		post := h.seedItem(feed.ID, "https://example.com/after", nil)
		if post.ID <= boundary {
			t.Fatalf("post-boundary item %q <= boundary %q", post.ID, boundary)
		}
	}

	recorder := h.authed(http.MethodGet, "/api/feeds/unread-counts", nil)
	requireStatus(t, recorder, http.StatusOK)

	var counts unreadCountsResponse
	decodeBody(t, recorder, &counts)
	if !domain.IsValidUUIDv7(counts.Boundary) || counts.Boundary != spy.gotBoundary {
		t.Fatalf("counts boundary = %q, repo saw %q", counts.Boundary, spy.gotBoundary)
	}

	if len(counts.Items) != 1 || counts.Items[0].FeedID != feed.ID || counts.Items[0].Count != 1 {
		t.Fatalf("bounded unread counts = %+v, want count 1", counts.Items)
	}
}

func TestFeedReadAllValidationAndBoundary(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	beforeItem := h.seedItem(feed.ID, "https://example.com/before", nil)
	boundary := domain.NewID()
	afterItem := h.seedItem(feed.ID, "https://example.com/after", nil)

	invalidID := domain.NewID()
	badBodies := []string{
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
	}

	for _, endpoint := range []string{"/api/feeds/" + feed.ID + "/read-all", "/api/feed-items/read-all"} {
		for _, body := range badBodies {
			requireAPIError(t, h.do(h.rawRequest(http.MethodPost, endpoint, body)), http.StatusBadRequest, "RequestFailed")
		}
	}

	if h.feedItemByID(beforeItem.ID).Read || h.feedItemByID(afterItem.ID).Read {
		t.Fatal("invalid read-all payloads changed read state")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", map[string]any{"before": boundary}), http.StatusNoContent)
	if !h.feedItemByID(beforeItem.ID).Read || h.feedItemByID(afterItem.ID).Read {
		t.Fatalf("bounded feed read-all read states = (%v, %v), want (true, false)", h.feedItemByID(beforeItem.ID).Read, h.feedItemByID(afterItem.ID).Read)
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+domain.NewID()+"/read-all", map[string]any{"before": domain.NewID()}), http.StatusNoContent)

	otherFeed := h.seedFeed("Other", "https://other.example.com/rss", nil)
	otherBefore := h.seedItem(otherFeed.ID, "https://other.example.com/before", nil)
	allBoundary := domain.NewID()
	otherAfter := h.seedItem(otherFeed.ID, "https://other.example.com/after", nil)

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read-all", map[string]any{"before": allBoundary}), http.StatusNoContent)
	if !h.feedItemByID(afterItem.ID).Read || !h.feedItemByID(otherBefore.ID).Read || h.feedItemByID(otherAfter.ID).Read {
		t.Fatalf("bounded feed-items read-all did not respect boundary")
	}
}

func TestFeedListExposesSiteURLAndDerivedRefreshState(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	synced := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	untouched := h.seedFeed("Untouched", "https://feeds.example.com/other", nil)

	finishedAt := h.clock.Now().Add(2 * time.Second)
	meta := domain.FeedSyncMeta{
		Title:   "Go Blog",
		SiteURL: strPtr("https://go.dev/blog/"),
		IconURL: strPtr("https://go.dev/favicon.ico"),
	}

	h.succeedRefresh(synced.ID, meta, finishedAt)

	recorder := h.authed(http.MethodGet, "/api/feeds", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload struct {
		Items []map[string]any `json:"items"`
	}
	decodeBody(t, recorder, &payload)

	byID := make(map[string]map[string]any, len(payload.Items))
	for _, item := range payload.Items {
		byID[item["id"].(string)] = item
	}

	got := byID[synced.ID]
	if got["siteUrl"] != "https://go.dev/blog/" || got["iconUrl"] != "https://go.dev/favicon.ico" || got["updatedAt"] != finishedAt.Format(time.RFC3339) {
		t.Fatalf("synced feed = %+v", got)
	}

	untouchedFeed, listed := byID[untouched.ID]
	if !listed {
		t.Fatalf("untouched feed %s missing from %+v", untouched.ID, payload.Items)
	}

	for _, key := range []string{"siteUrl", "iconUrl", "updatedAt"} {
		if _, present := untouchedFeed[key]; present {
			t.Fatalf("%s must be omitted for a feed that was never refreshed: %+v", key, untouchedFeed)
		}
	}
}
