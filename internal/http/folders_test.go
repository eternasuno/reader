package httpserver

import (
	"net/http"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestFolderCRUD(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "  Tech  "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[folderJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Name != "Tech" {
		t.Fatalf("created folder = %+v", created.Item)
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "   "}), http.StatusBadRequest, "InvalidFolderName")
	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "Tech"}), http.StatusConflict, "FolderAlreadyExists")

	requireStatus(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": "Technology"}), http.StatusNoContent)
	if got := h.folderByID(created.Item.ID).Name; got != "Technology" {
		t.Fatalf("renamed folder = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+domain.NewID(), map[string]any{"name": "Nope"}), http.StatusNotFound, "FolderNotFound")

	other := h.seedFolder("Life")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": other.Name}), http.StatusConflict, "FolderAlreadyExists")

	recorder = h.authed(http.MethodGet, "/api/folders", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[folderJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 2 || listed.Items[0].Name != "Life" || listed.Items[1].Name != "Technology" {
		t.Fatalf("folder list = %+v", listed.Items)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+created.Item.ID, nil), http.StatusNoContent)
	if h.folderByID(created.Item.ID) != nil {
		t.Fatal("folder was not deleted")
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+domain.NewID(), nil), http.StatusNoContent)
}

func TestFolderDeleteMovesFeedsToTopLevel(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+folder.ID, nil), http.StatusNoContent)

	moved := h.feedByID(feed.ID)
	if moved == nil {
		t.Fatal("deleting a folder must not delete its feeds")
	}

	if moved.FolderID != nil {
		t.Fatalf("feed folder after delete = %v", moved.FolderID)
	}

	recorder := h.authed(http.MethodGet, "/api/feeds", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[feedJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 1 {
		t.Fatalf("feeds = %+v", listed.Items)
	}

	if listed.Items[0].FolderID != nil {
		t.Fatalf("top-level feed serialized folderId = %v", *listed.Items[0].FolderID)
	}

	if strings.Contains(recorder.Body.String(), `"folderId"`) {
		t.Fatalf("absent folderId must be omitted: %s", recorder.Body.String())
	}
}

func TestFolderItemsAndReadAll(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	inFolder := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	outside := h.seedFeed("Other", "https://other.example.com/rss", nil)
	read := h.seedItem(inFolder.ID, "https://example.com/read", func(item *domain.FeedItem) { item.Read = true })
	unread := h.seedItem(inFolder.ID, "https://example.com/unread", nil)
	outsideItem := h.seedItem(outside.ID, "https://example.com/outside", nil)

	recorder := h.authed(http.MethodGet, "/api/folders/"+folder.ID+"/items?unread", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[feedItemJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != unread.ID || !domain.IsValidUUIDv7(page.Boundary) {
		t.Fatalf("folder unread items = %+v boundary = %q", page.Items, page.Boundary)
	}

	invalidID := domain.NewID()
	for _, body := range []string{
		"",
		`{}`,
		`null`,
		`{"before":null}`,
		`{"before":"not-a-uuid"}`,
		`{"before":"` + invalidID + `","extra":1}`,
	} {
		requireAPIError(t, h.do(h.rawRequest(http.MethodPost, "/api/folders/"+folder.ID+"/read-all", body)), http.StatusBadRequest, "RequestFailed")
	}

	if h.feedItemByID(unread.ID).Read {
		t.Fatal("invalid folder read-all changed read state")
	}

	boundary := domain.NewID()
	postBoundary := h.seedItem(inFolder.ID, "https://example.com/after", nil)

	requireStatus(t, h.authed(http.MethodPost, "/api/folders/"+folder.ID+"/read-all", map[string]any{"before": boundary}), http.StatusNoContent)
	if !h.feedItemByID(unread.ID).Read || !h.feedItemByID(read.ID).Read {
		t.Fatal("folder read-all did not mark items read")
	}

	if h.feedItemByID(postBoundary.ID).Read {
		t.Fatal("folder read-all marked post-boundary item read")
	}

	if h.feedItemByID(outsideItem.ID).Read {
		t.Fatal("folder read-all marked outside item read")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/folders/"+domain.NewID()+"/read-all", map[string]any{"before": domain.NewID()}), http.StatusNoContent)

	recorder = h.authed(http.MethodGet, "/api/folders/"+domain.NewID()+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 0 || !domain.IsValidUUIDv7(page.Boundary) {
		t.Fatalf("unknown folder items = %+v boundary = %q", page.Items, page.Boundary)
	}
}
