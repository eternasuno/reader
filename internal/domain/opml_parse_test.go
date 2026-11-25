package domain

import (
	"fmt"
	"strings"
	"testing"
)

func TestOPMLParseFlattensNestedOutlines(t *testing.T) {
	data := []byte("\xef\xbb\xbf" + `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>subscriptions</title></head>
  <body>
    <outline text="Tech">
      <outline text="Go Blog" xmlUrl="https://example.com/go.xml"/>
      <outline text="Deep">
        <outline title="Rust Blog" xmlUrl="https://example.com/rust.xml"/>
      </outline>
    </outline>
    <outline text="Loose Blog" xmlUrl="https://example.com/loose.xml"/>
  </body>
</opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if document.SkippedInvalid != 0 {
		t.Fatalf("SkippedInvalid = %d, want 0", document.SkippedInvalid)
	}

	if !strings.EqualFold(strings.Join(document.Folders, ","), "Tech,Deep") {
		t.Fatalf("Folders = %v, want [Tech Deep]", document.Folders)
	}

	if len(document.Feeds) != 3 {
		t.Fatalf("got %d feeds, want 3", len(document.Feeds))
	}

	cases := []struct {
		title  string
		folder string
		url    string
	}{
		{title: "Go Blog", folder: "Tech", url: "https://example.com/go.xml"},
		{title: "Rust Blog", folder: "Deep", url: "https://example.com/rust.xml"},
		{title: "Loose Blog", folder: "<top>", url: "https://example.com/loose.xml"},
	}

	for i, testCase := range cases {
		feed := document.Feeds[i]
		if feed.Title != testCase.title {
			t.Fatalf("Feeds[%d].Title = %q, want %q", i, feed.Title, testCase.title)
		}

		if got := opmlTestFolderName(feed); got != testCase.folder {
			t.Fatalf("Feeds[%d] folder = %q, want %q", i, got, testCase.folder)
		}

		if feed.URL.Raw() != testCase.url {
			t.Fatalf("Feeds[%d].URL = %q, want %q", i, feed.URL.Raw(), testCase.url)
		}
	}
}

func TestOPMLParseRecordsEmptyFolders(t *testing.T) {
	data := []byte(`<opml version="2.0"><body>
  <outline text="Empty"/>
  <outline title="Titled"/>
  <outline text="Empty"/>
</body></opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if len(document.Feeds) != 0 {
		t.Fatalf("got %d feeds, want none", len(document.Feeds))
	}

	if strings.Join(document.Folders, ",") != "Empty,Titled" {
		t.Fatalf("Folders = %v, want [Empty Titled]", document.Folders)
	}
}

func TestOPMLParseSkipsInvalidAndDuplicateFeeds(t *testing.T) {
	data := []byte(`<opml version="2.0"><body>
  <outline text="FTP" xmlUrl="ftp://example.com/feed.xml"/>
  <outline text="Relative" xmlUrl="example.com/feed.xml"/>
  <outline text="Lowercase" xmlurl="https://example.com/lower.xml"/>
  <outline text="Upper" xmlURL="https://example.com/upper.xml"/>
  <outline text="Kept" xmlUrl="https://example.com/kept.xml"/>
  <outline text="Kept Again" xmlUrl="https://example.com/kept.xml"/>
</body></opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if document.SkippedInvalid != 3 {
		t.Fatalf("SkippedInvalid = %d, want 3", document.SkippedInvalid)
	}

	wantURLs := []string{"https://example.com/lower.xml", "https://example.com/upper.xml", "https://example.com/kept.xml"}
	if len(document.Feeds) != len(wantURLs) {
		t.Fatalf("got %d feeds, want %d", len(document.Feeds), len(wantURLs))
	}

	for i, want := range wantURLs {
		if document.Feeds[i].URL.Raw() != want {
			t.Fatalf("Feeds[%d].URL = %q, want %q", i, document.Feeds[i].URL.Raw(), want)
		}
	}

	if document.Feeds[2].Title != "Kept" {
		t.Fatalf("Feeds[2].Title = %q, want %q", document.Feeds[2].Title, "Kept")
	}
}

func TestOPMLParseRejectsTrailingContent(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"trailing fragment":   `<opml version="2.0"><body><outline text="Tech" xmlUrl="https://example.com/a.xml"/></body></opml><broken`,
		"second root":         `<opml version="2.0"><body></body></opml><opml version="2.0"><body></body></opml>`,
		"trailing text":       `<opml version="2.0"><body></body></opml>oops`,
		"trailing nbsp":       `<opml version="2.0"><body></body></opml>` + "\u00a0",
		"leading text":        `oops<opml version="2.0"><body></body></opml>`,
		"leading char ref":    `&#32;<opml version="2.0"><body></body></opml>`,
		"trailing cdata":      `<opml version="2.0"><body></body></opml><![CDATA[ ]]>`,
		"leading nbsp":        "\u00a0" + `<opml version="2.0"><body></body></opml>`,
		"trailing second doc": `<opml version="2.0"><body></body></opml><OPML version="2.0"><body></body></OPML>`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, err := ParseOPML([]byte(payload))
			if code := opmlTestErrorCode(t, err); code != ErrInvalidOpml {
				t.Fatalf("error code = %q, want %q", code, ErrInvalidOpml)
			}
		})
	}
}

func TestOPMLParseAllowsTrailingWhitespaceAndComments(t *testing.T) {
	t.Parallel()

	data := []byte(`<opml version="2.0"><body><outline text="Tech" xmlUrl="https://example.com/a.xml"/></body></opml>
<!-- trailing comment -->
`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if len(document.Feeds) != 1 {
		t.Fatalf("got %d feeds, want 1", len(document.Feeds))
	}
}

func TestOPMLParseSkipsRSSOutlineWithoutUsableURL(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"blank":   `<outline type="rss" title="Blank" text="Blank" xmlUrl="   "/>`,
		"missing": `<outline type="rss" title="No URL" text="No URL"/>`,
	}

	for name, outline := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			data := []byte(`<opml version="2.0"><body>` + outline + `</body></opml>`)
			document, err := ParseOPML(data)
			if err != nil {
				t.Fatalf("ParseOPML returned %v", err)
			}

			if document.SkippedInvalid != 1 {
				t.Fatalf("SkippedInvalid = %d, want 1", document.SkippedInvalid)
			}

			if len(document.Folders) != 0 || len(document.Feeds) != 0 {
				t.Fatalf("document = %+v, want empty", document)
			}
		})
	}
}

func TestOPMLParseTraversesDescendantsOfFeedOutlines(t *testing.T) {
	t.Parallel()

	data := []byte(`<opml version="2.0"><body>
  <outline text="Tech">
    <outline text="Parent Feed" xmlUrl="https://example.com/parent.xml">
      <outline text="Child Feed" xmlUrl="https://example.com/child.xml"/>
      <outline text="Nested Folder">
        <outline text="Grandchild Feed" xmlUrl="https://example.com/grandchild.xml"/>
      </outline>
    </outline>
  </outline>
  <outline text="Top Parent" xmlUrl="https://example.com/top-parent.xml">
    <outline text="Top Child" xmlUrl="https://example.com/top-child.xml"/>
  </outline>
  <outline text="Invalid Parent" xmlUrl="">
    <outline text="Recovered Child" xmlUrl="https://example.com/recovered.xml"/>
  </outline>
</body></opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if document.SkippedInvalid != 1 {
		t.Fatalf("SkippedInvalid = %d, want 1", document.SkippedInvalid)
	}

	if strings.Join(document.Folders, ",") != "Tech,Nested Folder" {
		t.Fatalf("Folders = %v, want [Tech Nested Folder]", document.Folders)
	}

	want := []struct {
		title  string
		folder string
		url    string
	}{
		{title: "Parent Feed", folder: "Tech", url: "https://example.com/parent.xml"},
		{title: "Child Feed", folder: "Tech", url: "https://example.com/child.xml"},
		{title: "Grandchild Feed", folder: "Nested Folder", url: "https://example.com/grandchild.xml"},
		{title: "Top Parent", folder: "<top>", url: "https://example.com/top-parent.xml"},
		{title: "Top Child", folder: "<top>", url: "https://example.com/top-child.xml"},
		{title: "Recovered Child", folder: "<top>", url: "https://example.com/recovered.xml"},
	}

	if len(document.Feeds) != len(want) {
		t.Fatalf("got %d feeds, want %d", len(document.Feeds), len(want))
	}

	for i, tc := range want {
		feed := document.Feeds[i]
		if feed.Title != tc.title || opmlTestFolderName(feed) != tc.folder || feed.URL.Raw() != tc.url {
			t.Fatalf("Feeds[%d] = (%q, %q, %q), want (%q, %q, %q)", i, feed.Title, opmlTestFolderName(feed), feed.URL.Raw(), tc.title, tc.folder, tc.url)
		}
	}
}

func TestOPMLParseRejectsOutlineLimitAndDepth(t *testing.T) {
	t.Parallel()

	var outlines strings.Builder
	for i := range maxOPMLOutlines + 1 {
		fmt.Fprintf(&outlines, `<outline text="Feed %d" xmlUrl="https://example.com/%d.xml"/>`, i, i)
	}

	tooMany := []byte(`<opml version="2.0"><body>` + outlines.String() + `</body></opml>`)
	_, err := ParseOPML(tooMany)
	if code := opmlTestErrorCode(t, err); code != ErrInvalidOpml {
		t.Fatalf("error code = %q, want %q", code, ErrInvalidOpml)
	}

	deep := []byte(`<opml version="2.0"><body>` + strings.Repeat(`<outline text="Folder">`, maxOPMLDepth) + strings.Repeat(`</outline>`, maxOPMLDepth) + `</body></opml>`)
	_, err = ParseOPML(deep)
	if code := opmlTestErrorCode(t, err); code != ErrInvalidOpml {
		t.Fatalf("deep error code = %q, want %q", code, ErrInvalidOpml)
	}
}

func TestOPMLParseRejectsMalformedSecurityAndAttributeCases(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"truncated document":                `<opml version="2.0"><body><outline text="Tech">`,
		"missing body":                      `<opml version="2.0"><head><title>subscriptions</title></head></opml>`,
		"duplicate xmlUrl attribute":        `<opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss" xmlUrl="https://b.example.com/rss"/></body></opml>`,
		"case-duplicate xmlUrl attribute":   `<opml version="2.0"><body><outline text="A" xmlUrl="https://a.example.com/rss" xmlurl="https://b.example.com/rss"/></body></opml>`,
		"duplicate folder text attribute":   `<opml version="2.0"><body><outline text="A" text="B"/></body></opml>`,
		"duplicate opml version attribute":  `<opml version="2.0" version="1.0"><body></body></opml>`,
		"whitespace before xml declaration": " \n<?xml version=\"1.0\" encoding=\"UTF-8\"?><opml version=\"2.0\"><body></body></opml>",
		"comment before xml declaration":    `<!-- note --><?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body></body></opml>`,
		"duplicate xml declaration":         `<?xml version="1.0" encoding="UTF-8"?><?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body></body></opml>`,
		"xml declaration inside body":       `<opml version="2.0"><body><?xml version="1.0" encoding="UTF-8"?></body></opml>`,
		"xml declaration after root":        `<opml version="2.0"><body></body></opml><?xml version="1.0" encoding="UTF-8"?>`,
		"doctype before root":               `<!DOCTYPE opml><opml version="2.0"><body></body></opml>`,
		"doctype after xml declaration":     `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE opml SYSTEM "http://example.com/opml.dtd"><opml version="2.0"><body></body></opml>`,
		"doctype with entity before root":   `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE opml [<!ENTITY feed "https://example.com/rss">]><opml version="2.0"><body></body></opml>`,
		"entity directive inside body":      `<opml version="2.0"><body><!ENTITY feed "https://example.com/rss"></body></opml>`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, err := ParseOPML([]byte(payload))
			if code := opmlTestErrorCode(t, err); code != ErrInvalidOpml {
				t.Fatalf("error code = %q, want %q", code, ErrInvalidOpml)
			}
		})
	}
}

func TestOPMLParseAcceptsCommonFeedReaderExportsWithAndWithoutHead(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"xml declaration with head": `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Reader Subscriptions</title>
    <dateCreated>Mon, 01 Jan 2024 00:00:00 GMT</dateCreated>
  </head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Go Blog" title="Go Blog" xmlUrl="https://go.dev/blog/feed.atom"/>
    </outline>
  </body>
</opml>`,
		"xml declaration without head": `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline type="rss" text="Go Blog" xmlUrl="https://go.dev/blog/feed.atom"/>
  </body>
</opml>`,
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			document, err := ParseOPML([]byte(payload))
			if err != nil {
				t.Fatalf("ParseOPML returned %v", err)
			}

			if len(document.Feeds) != 1 {
				t.Fatalf("got %d feeds, want 1", len(document.Feeds))
			}

			wantFolder := "<top>"
			if name == "xml declaration with head" {
				wantFolder = "Tech"
			}

			feed := document.Feeds[0]
			if feed.Title != "Go Blog" || feed.URL.Raw() != "https://go.dev/blog/feed.atom" || opmlTestFolderName(feed) != wantFolder {
				t.Fatalf("feed = %+v, folder = %q; want Go Blog, https://go.dev/blog/feed.atom, %q", feed, opmlTestFolderName(feed), wantFolder)
			}
		})
	}
}
