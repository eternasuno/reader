package domain

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func opmlTestURL(raw string) NormalizedURL {
	feedURL, err := ParseNormalizedURL(raw, ErrFeedUrlInvalid)
	if err != nil {
		panic(err)
	}

	return feedURL
}

func opmlTestFeed(t *testing.T, id string, title string, rawURL string) Feed {
	t.Helper()

	return Feed{ID: id, Title: title, URL: opmlTestURL(rawURL)}
}

func opmlTestFolderName(feed OPMLFeedInput) string {
	if feed.FolderName == nil {
		return "<top>"
	}

	return *feed.FolderName
}

func opmlTestErrorCode(t *testing.T, err error) ErrorCode {
	t.Helper()

	if err == nil {
		t.Fatalf("expected an error, got nil")
	}

	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("error %v is not a *DomainError", err)
	}

	return domainErr.Code
}

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

func TestOPMLParseMalformedXML(t *testing.T) {
	code := opmlTestErrorCode(t, func() error {
		_, err := ParseOPML([]byte(`<opml version="2.0"><body><outline text="Tech">`))

		return err
	}())

	if code != ErrInvalidOpml {
		t.Fatalf("error code = %q, want %q", code, ErrInvalidOpml)
	}
}

func TestOPMLParseMissingBody(t *testing.T) {
	code := opmlTestErrorCode(t, func() error {
		_, err := ParseOPML([]byte(`<opml version="2.0"><head><title>subscriptions</title></head></opml>`))

		return err
	}())

	if code != ErrInvalidOpml {
		t.Fatalf("error code = %q, want %q", code, ErrInvalidOpml)
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

func TestOPMLParseFeedTitleFallsBack(t *testing.T) {
	data := []byte(`<opml version="2.0"><body>
  <outline text="  " xmlUrl="https://example.com/blank-title.xml"/>
</body></opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if len(document.Feeds) != 1 {
		t.Fatalf("got %d feeds, want 1", len(document.Feeds))
	}

	if document.Feeds[0].Title == "" {
		t.Fatalf("Feeds[0].Title is empty, want a fallback title")
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

func TestOPMLParseSkipsBlankFeedURL(t *testing.T) {
	t.Parallel()

	data := []byte(`<opml version="2.0"><body>
  <outline type="rss" title="Blank" text="Blank" xmlUrl="   "/>
</body></opml>`)

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML returned %v", err)
	}

	if document.SkippedInvalid != 1 {
		t.Fatalf("SkippedInvalid = %d, want 1", document.SkippedInvalid)
	}

	if len(document.Folders) != 0 {
		t.Fatalf("Folders = %v, want none", document.Folders)
	}

	if len(document.Feeds) != 0 {
		t.Fatalf("got %d feeds, want none", len(document.Feeds))
	}
}

func TestOPMLParseSkipsRSSOutlineWithoutURL(t *testing.T) {
	t.Parallel()

	data := []byte(`<opml version="2.0"><body>
  <outline type="rss" title="No URL" text="No URL"/>
</body></opml>`)

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
}

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

func TestOPMLExportEmptyDocument(t *testing.T) {
	data, err := ExportOPML(nil, nil)
	if err != nil {
		t.Fatalf("ExportOPML returned %v", err)
	}

	document, err := ParseOPML(data)
	if err != nil {
		t.Fatalf("ParseOPML of the export returned %v", err)
	}

	if len(document.Feeds) != 0 || len(document.Folders) != 0 {
		t.Fatalf("document = %+v, want empty", document)
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

func TestOPMLImportAndExportStripLabelCredentials(t *testing.T) {
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
}

func TestOPMLParseAndExportRedactApostropheInPassword(t *testing.T) {
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
}

func TestOPMLParseAndExportRedactMultiAtAndProseLabels(t *testing.T) {
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
