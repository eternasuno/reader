package httpserver

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestOPMLExport(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	h.seedFeed("Top Feed", "https://top.example.com/rss", nil)
	h.seedFeed("Private", "https://user:supersecret@private.example.com/rss", &folder.ID)

	recorder := h.authed(http.MethodGet, "/api/opml", nil)
	requireStatus(t, recorder, http.StatusOK)

	if contentType := recorder.Header().Get("Content-Type"); contentType != "text/x-opml+xml; charset=utf-8" {
		t.Fatalf("content type = %q", contentType)
	}

	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, `filename="subscriptions.opml"`) {
		t.Fatalf("content disposition = %q", disposition)
	}

	body := recorder.Body.String()
	wanted := []string{
		`<outline text="Tech"`,
		`xmlUrl="https://private.example.com/rss"`,
		`xmlUrl="https://top.example.com/rss"`,
		`version="2.0"`,
	}
	for _, want := range wanted {
		if !strings.Contains(body, want) {
			t.Fatalf("opml export is missing %q:\n%s", want, body)
		}
	}

	if strings.Contains(body, "supersecret") {
		t.Fatalf("opml export leaked url credentials:\n%s", body)
	}
}

func TestOPMLImportRawXML(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	existing := h.seedFeed("Go Blog", "https://go.example.com/rss", nil)
	h.succeedRefresh(existing.ID, domain.FeedSyncMeta{Title: existing.Title}, h.clock.Now())

	document := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline type="rss" text="Go Blog" xmlUrl="https://go.example.com/rss"/>
      <outline type="rss" text="Rust Blog" xmlUrl="https://rust.example.com/rss?utm_source=opml"/>
    </outline>
  </body>
</opml>`

	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(document))
	req.Header.Set("Content-Type", "text/x-opml+xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 1 || result.SkippedFeeds != 1 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	if wakes := h.refresher.wakeCount(); wakes != 1 {
		t.Fatalf("refresher wakes after import = %d, want 1", wakes)
	}

	feeds := h.allFeeds()
	var imported *domain.Feed
	for i := range feeds {
		if feeds[i].URL.RedactedString() == "https://rust.example.com/rss" {
			imported = &feeds[i]
		}
	}

	if imported == nil {
		t.Fatalf("imported feed missing: %+v", feeds)
	}

	if claimed := h.claimDueFeed(); claimed == nil || claimed.ID != imported.ID {
		t.Fatalf("claimed feed = %+v, want only the imported feed %s due", claimed, imported.ID)
	}

	if claimed := h.claimDueFeed(); claimed != nil {
		t.Fatalf("a skipped duplicate must keep its schedule, claimed %+v", claimed)
	}

	folders := h.allFolders()
	var tech *domain.Folder
	for i := range folders {
		if folders[i].Name == "Tech" {
			tech = &folders[i]
		}
	}

	if tech == nil {
		t.Fatal("folder Tech was not created")
	}

	if imported.FolderID == nil || *imported.FolderID != tech.ID {
		t.Fatalf("imported folder = %v", imported.FolderID)
	}

	for _, feed := range feeds {
		if feed.URL.RedactedString() == "https://go.example.com/rss" && feed.FolderID != nil {
			t.Fatal("a skipped duplicate must not be moved into the imported folder")
		}
	}
}

func TestOPMLImportExceedingFeedItemBudget(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	existing := h.seedFeed("Existing", "https://existing.example.com/rss", nil)
	h.succeedRefresh(existing.ID, domain.FeedSyncMeta{Title: existing.Title}, h.clock.Now())
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 5000}), http.StatusNoContent)

	document := `<opml version="2.0"><body><outline text="New folder">
		<outline type="rss" xmlUrl="https://first.example.com/rss"/>
		<outline type="rss" xmlUrl="https://second.example.com/rss"/>
	</outline></body></opml>`
	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(document))
	req.Header.Set("Content-Type", "text/x-opml+xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	requireAPIError(t, h.do(req), http.StatusBadRequest, "FeedItemBudgetExceeded")

	if feeds := h.allFeeds(); len(feeds) != 1 || feeds[0].ID != existing.ID {
		t.Fatalf("feeds after rejected import = %+v, want only %s", feeds, existing.ID)
	}

	if folders := h.allFolders(); len(folders) != 0 {
		t.Fatalf("folders after rejected import = %+v, want none", folders)
	}

	if wakes := h.refresher.wakeCount(); wakes != 0 {
		t.Fatalf("refresher wakes after rejected import = %d, want 0", wakes)
	}

	if claimed := h.claimDueFeed(); claimed != nil {
		t.Fatalf("claimed feed after rejected import = %+v, want none", claimed)
	}
}

func TestOPMLImportMultipart(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	document := `<opml version="2.0"><body><outline text="News"><outline type="rss" text="A" xmlUrl="https://a.example.com/rss"/><outline type="rss" text="B" xmlUrl="https://b.example.com/rss"/></outline></body></opml>`

	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	part, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}

	if _, err := part.Write([]byte(document)); err != nil {
		t.Fatalf("write form file: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(payload.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 2 || result.SkippedFeeds != 0 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	if wakes := h.refresher.wakeCount(); wakes != 1 {
		t.Fatalf("refresher wakes after import = %d, want 1", wakes)
	}

	for range 2 {
		if claimed := h.claimDueFeed(); claimed == nil {
			t.Fatal("every imported feed must be due immediately")
		}
	}
}

func TestOPMLImportRejectsMalformedDocuments(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"non-OPML root":                           `<rss><channel/></rss>`,
		"duplicate xmlUrl attribute":              `<opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss" xmlUrl="https://b.example.com/rss"/></body></opml>`,
		"case-duplicate xmlUrl attribute":         `<opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss" xmlurl="https://b.example.com/rss"/></body></opml>`,
		"misplaced xml declaration after comment": `<!-- note --><?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss"/></body></opml>`,
		"misplaced xml declaration inside body":   `<opml version="2.0"><body><?xml version="1.0" encoding="UTF-8"?><outline text="A" xmlUrl="https://a.example.com/rss"/></body></opml>`,
		"misplaced xml declaration after root":    `<opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss"/></body></opml><?xml version="1.0" encoding="UTF-8"?>`,
		"doctype directive before root":           `<!DOCTYPE opml><opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss"/></body></opml>`,
		"doctype entity directive":                `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE opml [<!ENTITY feed "https://a.example.com/rss">]><opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss"/></body></opml>`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			h := newHarness(t)

			req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(payload))
			req.Header.Set("Content-Type", "text/xml")
			req.Header.Set("Origin", testAppURL)
			req.AddCookie(h.sessionCookie())

			recorder := h.do(req)
			requireAPIError(t, recorder, http.StatusBadRequest, "InvalidOpml")

			if len(h.allFeeds()) != 0 || len(h.allFolders()) != 0 {
				t.Fatal("malformed OPML must not write anything")
			}

			if wakes := h.refresher.wakeCount(); wakes != 0 {
				t.Fatalf("malformed OPML must not wake refreshers, got %d wakes", wakes)
			}
		})
	}
}

func TestOPMLExportIncludesHeadAndRoundTrips(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.authed(http.MethodGet, "/api/opml", nil)
	requireStatus(t, recorder, http.StatusOK)

	body := recorder.Body.String()
	headIdx := strings.Index(body, "<head>")
	bodyIdx := strings.Index(body, "<body>")
	if headIdx < 0 || bodyIdx < 0 || headIdx >= bodyIdx {
		t.Fatalf("empty export must emit <head> before <body>:\n%s", body)
	}

	if !strings.Contains(body, "<title>Lantern</title>") {
		t.Fatalf("empty export is missing <title>Lantern</title>:\n%s", body)
	}

	importReq := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(body))
	importReq.Header.Set("Content-Type", "text/x-opml+xml")
	importReq.Header.Set("Origin", testAppURL)
	importReq.AddCookie(h.sessionCookie())

	importRec := h.do(importReq)
	requireStatus(t, importRec, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, importRec, &result)
	if result.ImportedFeeds != 0 || result.SkippedFeeds != 0 || result.CreatedFolders != 0 {
		t.Fatalf("empty round-trip import result = %+v", result)
	}
}

func TestOPMLImportMultipartFallbackAndSizeLimits(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	document := `<opml version="2.0"><body><outline type="rss" text="Fallback" xmlUrl="https://fallback.example.com/rss"/></body></opml>`

	var fallbackBuf bytes.Buffer
	writer := multipart.NewWriter(&fallbackBuf)
	part, err := writer.CreateFormFile("opml", "custom.opml")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte(document)); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(fallbackBuf.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())
	requireStatus(t, h.do(req), http.StatusOK)
	feeds := h.allFeeds()
	if len(feeds) != 1 || feeds[0].URL.Raw() != "https://fallback.example.com/rss" {
		t.Fatalf("fallback imported feeds = %+v", feeds)
	}

	var emptyBuf bytes.Buffer
	emptyWriter := multipart.NewWriter(&emptyBuf)
	_ = emptyWriter.WriteField("note", "no-file")
	_ = emptyWriter.Close()
	noFileReq := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(emptyBuf.Bytes()))
	noFileReq.Header.Set("Content-Type", emptyWriter.FormDataContentType())
	noFileReq.Header.Set("Origin", testAppURL)
	noFileReq.AddCookie(h.sessionCookie())
	requireAPIError(t, h.do(noFileReq), http.StatusBadRequest, "InvalidOpml")

	oversized := `<opml version="2.0"><body><!--` + strings.Repeat("a", maxOPMLUploadBytes+1) + `--></body></opml>`
	rawTooLarge := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(oversized))
	rawTooLarge.Header.Set("Content-Type", "text/xml")
	rawTooLarge.Header.Set("Origin", testAppURL)
	rawTooLarge.AddCookie(h.sessionCookie())
	requireAPIError(t, h.do(rawTooLarge), http.StatusBadRequest, "InvalidOpml")
}

func TestOPMLImportMultipartRejectsMultipleFilesAndOversize(t *testing.T) {
	t.Parallel()

	validDoc := `<opml version="2.0"><body><outline type="rss" text="A" xmlUrl="https://a.example.com/rss"/></body></opml>`

	type opmlPart struct {
		field    string
		filename string
		content  string
	}

	cases := []struct {
		name  string
		parts []opmlPart
	}{
		{
			name: "two files under fallback field",
			parts: []opmlPart{
				{field: "opml", filename: "a.opml", content: validDoc},
				{field: "opml", filename: "b.opml", content: validDoc},
			},
		},
		{
			name: "two files under distinct fallback fields",
			parts: []opmlPart{
				{field: "opml", filename: "a.opml", content: validDoc},
				{field: "backup", filename: "b.opml", content: validDoc},
			},
		},
		{
			name: "expected file field plus extra file",
			parts: []opmlPart{
				{field: "file", filename: "a.opml", content: validDoc},
				{field: "extra", filename: "b.opml", content: validDoc},
			},
		},
		{
			name: "oversized multipart upload",
			parts: []opmlPart{
				{field: "opml", filename: "big.opml", content: `<opml version="2.0"><body><!--` + strings.Repeat("a", maxOPMLUploadBytes+1) + `--></body></opml>`},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			h := newHarness(t)

			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for _, partSpec := range tc.parts {
				part, err := writer.CreateFormFile(partSpec.field, partSpec.filename)
				if err != nil {
					t.Fatalf("create form file: %v", err)
				}

				if _, err := part.Write([]byte(partSpec.content)); err != nil {
					t.Fatalf("write form file: %v", err)
				}
			}

			if err := writer.Close(); err != nil {
				t.Fatalf("close multipart writer: %v", err)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(body.Bytes()))
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.Header.Set("Origin", testAppURL)
			req.AddCookie(h.sessionCookie())

			requireAPIError(t, h.do(req), http.StatusBadRequest, "InvalidOpml")

			if len(h.allFeeds()) != 0 || len(h.allFolders()) != 0 {
				t.Fatal("rejected OPML multipart upload must not write anything")
			}

			if wakes := h.refresher.wakeCount(); wakes != 0 {
				t.Fatalf("rejected OPML multipart upload must not wake refreshers, got %d wakes", wakes)
			}
		})
	}
}
