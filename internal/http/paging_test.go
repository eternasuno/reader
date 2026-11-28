package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"reader/internal/domain"
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

func TestGroupedFeedItemSnapshots(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	oldest := h.seedFeed("Oldest", "https://feeds.example.com/oldest", &folder.ID)
	newest := h.seedFeed("Newest", "https://feeds.example.com/newest", &folder.ID)
	outside := h.seedFeed("Outside", "https://feeds.example.com/outside", nil)
	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+oldest.ID+"/order", map[string]any{"order": "oldest"}), http.StatusNoContent)

	oldestFirst := h.seedItem(oldest.ID, "https://example.com/oldest-first", nil)
	oldestSecond := h.seedItem(oldest.ID, "https://example.com/oldest-second", nil)
	newestFirst := h.seedItem(newest.ID, "https://example.com/newest-first", nil)
	newestSecond := h.seedItem(newest.ID, "https://example.com/newest-second", nil)
	oldestRead := h.seedItem(oldest.ID, "https://example.com/oldest-read", func(item *domain.FeedItem) { item.Read = true })
	outsideItem := h.seedItem(outside.ID, "https://example.com/outside", nil)

	wantAll := []snapshotGroup{
		{FeedID: newest.ID, IDs: []string{newestSecond.ID, newestFirst.ID}},
		{FeedID: oldest.ID, IDs: []string{oldestFirst.ID, oldestSecond.ID}},
		{FeedID: outside.ID, IDs: []string{outsideItem.ID}},
	}
	wantFolder := wantAll[:2]
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/feed-items/order?unread", nil), wantAll)
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/folders/"+folder.ID+"/items/order?unread=1", nil), wantFolder)

	wantAll[1].IDs = append(wantAll[1].IDs, oldestRead.ID)
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/feed-items/order?unread=false", nil), wantAll)
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/feed-items/order?unread&keep="+oldestRead.ID, nil), wantAll)
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/folders/"+folder.ID+"/items/order?unread&keep="+oldestRead.ID, nil), wantFolder)
}

func TestSingleFeedSnapshotOrder(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Oldest", "https://feeds.example.com/oldest", nil)
	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "oldest"}), http.StatusNoContent)
	first := h.seedItem(feed.ID, "https://example.com/first", nil)
	second := h.seedItem(feed.ID, "https://example.com/second", nil)
	read := h.seedItem(feed.ID, "https://example.com/read", func(item *domain.FeedItem) { item.Read = true })

	target := "/api/feeds/" + feed.ID + "/items/order"
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, target, nil), []snapshotGroup{{FeedID: feed.ID, IDs: []string{first.ID, second.ID, read.ID}}})
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, target+"?order=newest&unread=true", nil), []snapshotGroup{{FeedID: feed.ID, IDs: []string{second.ID, first.ID}}})
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, target+"?order=oldest", nil), []snapshotGroup{{FeedID: feed.ID, IDs: []string{first.ID, second.ID, read.ID}}})
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, target+"?unread&keep="+read.ID, nil), []snapshotGroup{{FeedID: feed.ID, IDs: []string{first.ID, second.ID, read.ID}}})
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, "/api/feeds/"+domain.NewID()+"/items/order", nil), []snapshotGroup{})
}

type snapshotGroup struct {
	FeedID string   `json:"feedId"`
	IDs    []string `json:"ids"`
}

func requireFeedItemSnapshot(t *testing.T, recorder *httptest.ResponseRecorder, groups []snapshotGroup) string {
	t.Helper()

	var snapshot struct {
		Boundary string          `json:"boundary"`
		Groups   []snapshotGroup `json:"groups"`
	}
	requireStatus(t, recorder, http.StatusOK)
	decodeSnapshotBody(t, recorder, &snapshot)
	if !reflect.DeepEqual(snapshot.Groups, groups) || !domain.IsValidUUIDv7(snapshot.Boundary) {
		t.Fatalf("snapshot = %s, want groups %+v and a UUIDv7 boundary", recorder.Body.String(), groups)
	}

	return snapshot.Boundary
}

func decodeSnapshotBody(t *testing.T, recorder *httptest.ResponseRecorder, dst any) {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(recorder.Body.Bytes()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		t.Fatalf("decode snapshot: %v (body %s)", err, recorder.Body.String())
	}
}

func TestSnapshotQueryValidation(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feedItems := "/api/feeds/" + domain.NewID() + "/items"
	folderItems := "/api/folders/" + domain.NewID() + "/items"
	for _, endpoint := range []string{"/api/feed-items/order", "/api/saved-pages/order", feedItems + "/order", folderItems + "/order"} {
		t.Run(endpoint, func(t *testing.T) {
			for _, query := range []string{
				"limit=1", "cursor=" + domain.NewID(), "boundary=" + domain.NewID(), "ids=" + domain.NewID(), "unread=true&unread=false", "unread=maybe", "unread=%ZZ", "unread=true;other=false",
				"keep=" + domain.NewID(), "unread=false&keep=" + domain.NewID(), "unread&keep=", "unread&keep=invalid", "unread&keep=" + domain.NewID() + "&keep=" + domain.NewID(),
			} {
				t.Run(query, func(t *testing.T) {
					requireAPIError(t, h.authed(http.MethodGet, endpoint+"?"+query, nil), http.StatusBadRequest, "RequestFailed")
				})
			}
		})
	}

	for _, endpoint := range []string{"/api/feed-items/order", "/api/saved-pages/order", folderItems + "/order"} {
		requireAPIError(t, h.authed(http.MethodGet, endpoint+"?order=newest", nil), http.StatusBadRequest, "RequestFailed")
	}

	for _, query := range []string{"order", "order=", "order=%20", "order=bogus", "order=NEWEST", "order=oldest&order=newest"} {
		requireAPIError(t, h.authed(http.MethodGet, feedItems+"/order?"+query, nil), http.StatusBadRequest, "RequestFailed")
	}

	for _, endpoint := range []string{feedItems, folderItems} {
		requireAPIError(t, h.authed(http.MethodGet, endpoint, nil), http.StatusNotFound, "RequestFailed")
	}
}

func TestBatchQueryValidation(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	ids := make([]string, domain.MaxBatchIDs+1)
	for i := range ids {
		ids[i] = domain.NewID()
	}

	for _, endpoint := range []string{"/api/feed-items", "/api/saved-pages"} {
		t.Run(endpoint, func(t *testing.T) {
			for _, query := range []string{
				"", "?ids=", "?ids=" + strings.Join(ids, ","), "?ids=" + ids[0] + "," + ids[0],
				"?ids=invalid", "?ids=" + ids[0] + ",", "?ids=%ZZ", "?ids=" + ids[0] + "&ids=" + ids[1], "?ids=" + ids[0] + "&unread",
			} {
				requireAPIError(t, h.authed(http.MethodGet, endpoint+query, nil), http.StatusBadRequest, "RequestFailed")
			}

			recorder := h.authed(http.MethodGet, endpoint+"?ids="+strings.Join(ids[:domain.MaxBatchIDs], ","), nil)
			requireStatus(t, recorder, http.StatusOK)
			if strings.TrimSpace(recorder.Body.String()) != `{"items":[]}` {
				t.Fatalf("batch of missing IDs = %s, want empty items array", recorder.Body.String())
			}
		})
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

// feedLookupSpy observes the feed preference lookup and can fail it.
type feedLookupSpy struct {
	domain.FeedRepository
	calls     int
	getErr    error
	onGetByID func(feedID string)
}

func (r *feedLookupSpy) GetByID(ctx context.Context, id string) (*domain.Feed, error) {
	r.calls++
	if r.onGetByID != nil {
		r.onGetByID(id)
	}

	if r.getErr != nil {
		return nil, r.getErr
	}

	return r.FeedRepository.GetByID(ctx, id)
}

func TestFeedItemsBoundaryMintedBeforePreferenceLookup(t *testing.T) {
	t.Parallel()

	var spy *feedLookupSpy
	h := newHarnessWith(t, func(cfg *Config) {
		spy = &feedLookupSpy{FeedRepository: cfg.Feeds}
		cfg.Feeds = spy
	})

	feed := h.seedFeed("Oldest", "https://feeds.example.com/oldest", nil)
	if err := h.db.Feeds().UpdateOrder(context.Background(), feed.ID, domain.SortOrderOldest); err != nil {
		t.Fatalf("update feed order: %v", err)
	}

	first := h.seedItem(feed.ID, "https://example.com/first", nil)
	second := h.seedItem(feed.ID, "https://example.com/second", nil)

	// Stored while the preference lookup is running: must fall after the boundary.
	var during domain.FeedItem
	spy.onGetByID = func(feedID string) {
		during = h.seedItem(feedID, "https://example.com/during", nil)
	}

	recorder := h.authed(http.MethodGet, "/api/feeds/"+feed.ID+"/items/order", nil)
	boundary := requireFeedItemSnapshot(t, recorder, []snapshotGroup{{FeedID: feed.ID, IDs: []string{first.ID, second.ID}}})
	if spy.calls != 1 || during.ID == "" {
		t.Fatalf("lookup calls = %d, in-lookup item = %q; want one lookup that stored an item", spy.calls, during.ID)
	}

	if boundary >= during.ID {
		t.Fatalf("boundary %q must be minted before in-lookup item %q", boundary, during.ID)
	}
}

func TestFeedItemSnapshotValidationPrecedesPreferenceLookup(t *testing.T) {
	t.Parallel()

	var spy *feedLookupSpy
	h := newHarnessWith(t, func(cfg *Config) {
		spy = &feedLookupSpy{FeedRepository: cfg.Feeds}
		cfg.Feeds = spy
	})
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)

	target := "/api/feeds/" + feed.ID + "/items/order"
	spy.getErr = domain.NewError(domain.ErrFeedRepositoryError, nil)
	requireAPIError(t, h.authed(http.MethodGet, target+"?limit=0", nil), http.StatusBadRequest, "RequestFailed")
	requireFeedItemSnapshot(t, h.authed(http.MethodGet, target+"?order=oldest", nil), []snapshotGroup{})
	if spy.calls != 0 {
		t.Fatalf("invalid or explicit-order query reached the preference lookup %d times", spy.calls)
	}

	requireAPIError(t, h.authed(http.MethodGet, target, nil), http.StatusInternalServerError, "FeedRepositoryError")
}
