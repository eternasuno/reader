package domain

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestOPMLExportSortsFoldersAndFeeds(t *testing.T) {
	folders := []OPMLExportFolder{
		{Name: "Tech", Feeds: []Feed{
			opmlTestFeed(t, "id-c", "Rust Blog", "https://example.com/rust.xml"),
			opmlTestFeed(t, "id-b", "Go Blog", "https://example.com/go.xml"),
			opmlTestFeed(t, "id-d", "Dup", "https://example.com/dup-b.xml"),
			opmlTestFeed(t, "id-a", "Dup", "https://example.com/dup-a.xml"),
		}},
		{Name: "Alpha", Feeds: []Feed{
			opmlTestFeed(t, "id-e", "Zed Blog", "https://example.com/zed.xml"),
		}},
	}
	topFeeds := []Feed{
		opmlTestFeed(t, "id-f", "Zeta Blog", "https://example.com/zeta.xml"),
		opmlTestFeed(t, "id-g", "Beta Blog", "https://example.com/beta.xml"),
	}

	data, err := ExportOPML(folders, topFeeds)
	if err != nil {
		t.Fatalf("ExportOPML returned %v", err)
	}

	body := string(data)
	if !strings.HasPrefix(body, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">") {
		t.Fatalf("unexpected prolog: %q", body[:min(len(body), 60)])
	}

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML of the export returned %v", err)
	}

	if strings.Join(document.Folders, ",") != "Alpha,Tech" {
		t.Fatalf("Folders = %v, want [Alpha Tech]", document.Folders)
	}

	wantOrder := []struct {
		title  string
		folder string
	}{
		{title: "Zed Blog", folder: "Alpha"},
		{title: "Dup", folder: "Tech"},
		{title: "Dup", folder: "Tech"},
		{title: "Go Blog", folder: "Tech"},
		{title: "Rust Blog", folder: "Tech"},
		{title: "Beta Blog", folder: "<top>"},
		{title: "Zeta Blog", folder: "<top>"},
	}

	if len(document.Feeds) != len(wantOrder) {
		t.Fatalf("got %d feeds, want %d", len(document.Feeds), len(wantOrder))
	}

	for i, want := range wantOrder {
		feed := document.Feeds[i]
		if feed.Title != want.title {
			t.Fatalf("Feeds[%d].Title = %q, want %q", i, feed.Title, want.title)
		}

		if got := opmlTestFolderName(feed); got != want.folder {
			t.Fatalf("Feeds[%d] folder = %q, want %q", i, got, want.folder)
		}
	}

	if !strings.Contains(body, `xmlUrl="https://example.com/dup-a.xml"`) || !strings.Contains(body, `xmlUrl="https://example.com/dup-b.xml"`) {
		t.Fatalf("export is missing duplicate-titled feed urls: %q", body)
	}

	if strings.Index(body, "dup-a.xml") > strings.Index(body, "dup-b.xml") {
		t.Fatalf("feeds with equal titles are not ordered by id")
	}
}

func TestOPMLExportStripsCredentials(t *testing.T) {
	folders := []OPMLExportFolder{
		{Name: "Private", Feeds: []Feed{
			opmlTestFeed(t, "id-a", "Private Blog", "https://user:pass@example.com/private.xml"),
		}},
	}

	data, err := ExportOPML(folders, []Feed{
		opmlTestFeed(t, "id-b", "Top Blog", "https://user:pass@example.com/top.xml"),
	})
	if err != nil {
		t.Fatalf("ExportOPML returned %v", err)
	}

	body := string(data)
	if strings.Contains(body, "user:pass@") || strings.Contains(body, "user") || strings.Contains(body, "pass") {
		t.Fatalf("export leaked credentials: %q", body)
	}

	if !strings.Contains(body, `xmlUrl="https://example.com/private.xml"`) {
		t.Fatalf("export is missing the redacted folder url: %q", body)
	}

	if !strings.Contains(body, `xmlUrl="https://example.com/top.xml"`) {
		t.Fatalf("export is missing the redacted top-level url: %q", body)
	}
}

func TestOPMLImportAndExportStripLabelCredentials(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		run  func(*testing.T)
	}{
		{"standard labels", func(t *testing.T) {
			t.Parallel()

			data := []byte(`<opml version="2.0"><body>
  <outline text="https://fuser:fpass@example.com/folder">
    <outline title="https://user:secret@example.com/feed.xml" xmlUrl="https://example.com/feed.xml"/>
    <outline text="http://user%20name:p%40ss@example.com/encoded" xmlUrl="https://example.com/encoded.xml"/>
  </outline>
  <outline text="Feed (https://tok@example.com/embedded)" xmlUrl="https://example.com/embedded.xml"/>
</body></opml>`)

			document, err := ParseOPML(data)
			if err != nil {
				t.Fatalf("ParseOPML returned %v", err)
			}

			if len(document.Folders) != 1 || document.Folders[0] != "https://example.com/folder" {
				t.Fatalf("Folders = %v", document.Folders)
			}

			wantTitles := []string{
				"https://example.com/feed.xml",
				"http://example.com/encoded",
				"Feed (https://example.com/embedded)",
			}
			for i, wantTitle := range wantTitles {
				if document.Feeds[i].Title != wantTitle {
					t.Fatalf("Feeds[%d].Title = %q, want %q", i, document.Feeds[i].Title, wantTitle)
				}
			}

			exported, err := ExportOPML([]OPMLExportFolder{
				{
					Name: "https://fuser:fpass@example.com/folder",
					Feeds: []Feed{
						opmlTestFeed(t, "id-1", "https://user:secret@example.com/feed.xml", "https://u:p@example.com/feed.xml"),
					},
				},
			}, []Feed{
				opmlTestFeed(t, "id-2", "Top (http://tok:pw@example.com/top)", "https://u:p@example.com/top.xml"),
			})
			if err != nil {
				t.Fatalf("ExportOPML returned %v", err)
			}

			body := string(exported)
			for _, secret := range []string{"fuser", "fpass", "user:secret", "tok:pw", "u:p@"} {
				if strings.Contains(body, secret) {
					t.Fatalf("export leaked credential %q in:\n%s", secret, body)
				}
			}

			if !strings.Contains(body, `text="https://example.com/folder"`) {
				t.Fatalf("export missing redacted folder label:\n%s", body)
			}

			if !strings.Contains(body, `title="https://example.com/feed.xml"`) {
				t.Fatalf("export missing redacted feed title:\n%s", body)
			}

			if !strings.Contains(body, `title="Top (http://example.com/top)"`) {
				t.Fatalf("export missing redacted top feed title:\n%s", body)
			}
		}},
		{"apostrophe and quoted prose", func(t *testing.T) {
			t.Parallel()

			data := []byte(`<opml version="2.0"><body>
  <outline text="see http://u:p'w@host/folder">
    <outline title="see http://u:p'w@host/x" xmlUrl="https://example.com/feed.xml"/>
    <outline text="quoted 'https://u:p'w@host/y'." xmlUrl="https://example.com/y.xml"/>
  </outline>
</body></opml>`)

			document, err := ParseOPML(data)
			if err != nil {
				t.Fatalf("ParseOPML returned %v", err)
			}

			if len(document.Folders) != 1 || document.Folders[0] != "see http://host/folder" {
				t.Fatalf("Folders = %v", document.Folders)
			}

			if document.Feeds[0].Title != "see http://host/x" {
				t.Fatalf("Feeds[0].Title = %q", document.Feeds[0].Title)
			}

			if document.Feeds[1].Title != "quoted 'https://host/y'." {
				t.Fatalf("Feeds[1].Title = %q", document.Feeds[1].Title)
			}

			exported, err := ExportOPML(nil, []Feed{
				opmlTestFeed(t, "id-1", "see http://u:p'w@host/x", "https://example.com/feed.xml"),
			})
			if err != nil {
				t.Fatalf("ExportOPML returned %v", err)
			}

			if strings.Contains(string(exported), "u:p'w") {
				t.Fatalf("export leaked apostrophe password:\n%s", string(exported))
			}

			if !strings.Contains(string(exported), `title="see http://host/x"`) {
				t.Fatalf("export missing redacted title:\n%s", string(exported))
			}
		}},
		{"multiple at signs and prose", func(t *testing.T) {
			t.Parallel()

			data := []byte(`<opml version="2.0"><body>
  <outline text="see http://user:p@ss@host/folder">
    <outline title="see http://user:p@ss@host/x" xmlUrl="https://example.com/feed.xml"/>
    <outline text="https://user:p@ss@example.com/whole" xmlUrl="https://example.com/whole.xml"/>
    <outline text="https://user:p)w@example.com/paren" xmlUrl="https://example.com/paren.xml"/>
    <outline text="quoted 'https://u:p'w@s@host/y'." xmlUrl="https://example.com/quoted.xml"/>
    <outline text="contact editor@example.com for https://example.com/plain" xmlUrl="https://example.com/plain.xml"/>
  </outline>
</body></opml>`)

			document, err := ParseOPML(data)
			if err != nil {
				t.Fatalf("ParseOPML returned %v", err)
			}

			if len(document.Folders) != 1 || document.Folders[0] != "see http://host/folder" {
				t.Fatalf("Folders = %v", document.Folders)
			}

			wantTitles := []string{
				"see http://host/x",
				"https://example.com/whole",
				"https://example.com/paren",
				"quoted 'https://host/y'.",
				"contact editor@example.com for https://example.com/plain",
			}
			for i, wantTitle := range wantTitles {
				if document.Feeds[i].Title != wantTitle {
					t.Fatalf("Feeds[%d].Title = %q, want %q", i, document.Feeds[i].Title, wantTitle)
				}
			}

			exported, err := ExportOPML([]OPMLExportFolder{
				{
					Name: "see http://user:p@ss@host/folder",
					Feeds: []Feed{
						opmlTestFeed(t, "id-1", "see http://user:p@ss@host/x", "https://example.com/feed.xml"),
						opmlTestFeed(t, "id-2", "https://user:p)w@example.com/paren", "https://example.com/paren.xml"),
						opmlTestFeed(t, "id-3", "contact editor@example.com for https://example.com/plain", "https://example.com/plain.xml"),
					},
				},
			}, nil)
			if err != nil {
				t.Fatalf("ExportOPML returned %v", err)
			}

			body := string(exported)
			for _, secret := range []string{"user:p@ss", "p@ss", "user:p)w"} {
				if strings.Contains(body, secret) {
					t.Fatalf("export leaked credential %q in:\n%s", secret, body)
				}
			}

			for _, wantAttr := range []string{
				`text="see http://host/folder"`,
				`title="see http://host/x"`,
				`title="https://example.com/paren"`,
				`title="contact editor@example.com for https://example.com/plain"`,
			} {
				if !strings.Contains(body, wantAttr) {
					t.Fatalf("export missing %s in:\n%s", wantAttr, body)
				}
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, tc.run)
	}
}

func TestOPMLExportIncludesHeadBeforeBodyAndRoundTrips(t *testing.T) {
	t.Parallel()

	t.Run("empty library", func(t *testing.T) {
		t.Parallel()

		data, err := ExportOPML(nil, nil)
		if err != nil {
			t.Fatalf("ExportOPML returned %v", err)
		}

		requireOPMLExportHeadBeforeBody(t, data)

		document, err := ParseOPML(data)
		if err != nil {
			t.Fatalf("ParseOPML of empty export returned %v", err)
		}

		if len(document.Feeds) != 0 || len(document.Folders) != 0 {
			t.Fatalf("document = %+v, want empty", document)
		}
	})

	t.Run("populated library", func(t *testing.T) {
		t.Parallel()

		folders := []OPMLExportFolder{
			{Name: "Tech", Feeds: []Feed{opmlTestFeed(t, "id-1", "Go Blog", "https://example.com/go.xml")}},
		}
		topFeeds := []Feed{
			opmlTestFeed(t, "id-2", "News", "https://example.com/news.xml"),
		}

		data, err := ExportOPML(folders, topFeeds)
		if err != nil {
			t.Fatalf("ExportOPML returned %v", err)
		}

		requireOPMLExportHeadBeforeBody(t, data)

		document, err := ParseOPML(data)
		if err != nil {
			t.Fatalf("ParseOPML of populated export returned %v", err)
		}

		if strings.Join(document.Folders, ",") != "Tech" || len(document.Feeds) != 2 {
			t.Fatalf("round-trip document = %+v, want folder Tech and 2 feeds", document)
		}
	})
}

func requireOPMLExportHeadBeforeBody(t *testing.T, data []byte) {
	t.Helper()

	decoder := xml.NewDecoder(bytes.NewReader(data))
	var children []string
	var titleText string
	var depth int
	var inTitle bool

	for {
		tok, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			t.Fatalf("decode exported opml: %v\n%s", err, data)
		}

		switch typed := tok.(type) {
		case xml.StartElement:
			depth++
			if depth == 2 {
				children = append(children, typed.Name.Local)
			}

			if depth == 3 && len(children) > 0 && children[len(children)-1] == "head" && typed.Name.Local == "title" {
				inTitle = true
			}
		case xml.CharData:
			if inTitle {
				titleText += string(typed)
			}
		case xml.EndElement:
			if inTitle && depth == 3 {
				inTitle = false
			}

			depth--
		}
	}

	if strings.Join(children, ",") != "head,body" {
		t.Fatalf("opml child elements = %v, want [head body]\n%s", children, data)
	}

	if titleText != "Lantern" {
		t.Fatalf("opml head title = %q, want %q\n%s", titleText, "Lantern", data)
	}
}
