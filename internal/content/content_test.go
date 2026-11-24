package content

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"reader/internal/domain"
)

const rssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Feed</title>
    <description>Feed description</description>
    <link>https://example.com/</link>
    <item>
      <title>First post</title>
      <link>/posts/first</link>
      <description>Plain description</description>
      <content:encoded><![CDATA[<p>Rich <strong>content</strong><a href="/posts/first#comments">Comments</a><script>alert(1)</script></p>]]></content:encoded>
      <pubDate>Mon, 02 Jan 2006 15:04:05 GMT</pubDate>
      <dc:date>2020-05-06T07:08:09Z</dc:date>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/posts/second</link>
      <description>Description only</description>
    </item>
    <item>
      <title>Missing link</title>
      <description>Dropped entry</description>
    </item>
  </channel>
</rss>`

const rdfFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel rdf:about="https://example.com/feed.rdf">
    <title>RDF Feed</title>
    <description>RDF description</description>
    <link>https://example.com/</link>
    <items>
      <rdf:Seq>
        <rdf:li rdf:resource="https://example.com/rdf/one"/>
      </rdf:Seq>
    </items>
  </channel>
  <item rdf:about="https://example.com/rdf/one">
    <title>RDF entry</title>
    <link>/rdf/one</link>
    <description>RDF entry description</description>
    <content:encoded><![CDATA[<p>RDF rich content</p>]]></content:encoded>
    <dc:date>2021-03-04T05:06:07Z</dc:date>
  </item>
</rdf:RDF>`

const atomFixture = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <subtitle>Atom subtitle</subtitle>
  <link rel="self" href="https://example.com/atom.xml"/>
  <entry>
    <title>Typed alternate</title>
    <link rel="self" href="https://example.com/self/one"/>
    <link rel="enclosure" href="https://example.com/audio/one.mp3" type="audio/mpeg"/>
    <link rel="alternate" href="/entries/untyped"/>
    <link rel="alternate" type="text/html" href="/entries/typed"/>
    <summary type="text">Tom &amp; Jerry &lt;b&gt;bold&lt;/b&gt;</summary>
    <content type="html">&lt;p&gt;Atom content &amp;amp; more&lt;/p&gt;</content>
    <published>2022-01-02T03:04:05Z</published>
    <updated>2023-01-02T03:04:05Z</updated>
  </entry>
  <entry>
    <title>Untyped alternate</title>
    <link rel="related" href="https://example.com/related/two"/>
    <link rel="alternate" href="/entries/two"/>
    <summary>Plain &amp; untyped summary</summary>
    <content type="html" src="https://example.com/external-content"/>
    <updated>2023-05-06T07:08:09Z</updated>
  </entry>
  <entry>
    <title>Other alternate</title>
    <link rel="alternate" type="application/json" href="https://example.com/entries/three"/>
    <content type="text">Text &lt;i&gt;content&lt;/i&gt;</content>
  </entry>
</feed>`

const credentialedRSSFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Credentialed Feed</title>
    <link>https://example.com/</link>
    <item>
      <title>Credentialed entry</title>
      <link>/posts/one</link>
      <description><![CDATA[<a href="/about">about</a>]]></description>
      <content:encoded><![CDATA[<p><a href="https://entry:pw@example.com/secret">link</a><img src="https://entry:pw@example.com/pic.png"></p>]]></content:encoded>
    </item>
  </channel>
</rss>`

const atomSummarySlotsFixture = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Summary Slots</title>
  <entry><title>No summary</title><link rel="alternate" href="https://example.com/slots/one"/></entry>
  <entry><title>Rich summary</title><link rel="alternate" href="https://example.com/slots/two"/><summary type="html">&lt;p&gt;Rich&lt;/p&gt;</summary></entry>
  <entry><title>Text summary</title><link rel="alternate" href="https://example.com/slots/three"/><summary type="text">1 &lt; 2</summary></entry>
</feed>`

const jsonFixture = `{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "JSON Feed",
  "description": "JSON description",
  "items": [
    {
      "id": "1",
      "url": "/json/one",
      "external_url": "https://external.example/one",
      "title": "JSON one",
      "summary": "Summary & <b>bold</b>",
      "content_html": "<p>HTML content</p>",
      "content_text": "ignored text",
      "date_published": "2024-05-06T07:08:09Z",
      "date_modified": "2025-05-06T07:08:09Z"
    },
    {
      "id": "2",
      "url": "https://example.com/json/two",
      "title": "JSON two",
      "content_text": "Plain & <i>text</i>",
      "date_published": "not a date"
    },
    {
      "id": "3",
      "external_url": "https://example.com/external-only",
      "title": "Missing url"
    }
  ]
}`

const articleFixture = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Readable article</title>
  <meta property="article:published_time" content="2020-02-03T04:05:06Z">
  <meta name="description" content="Excerpt &amp; summary of the article.">
  <meta property="og:site_name" content="Example Site">
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <article>
      <h1>Extracting the readable part</h1>
      <p>A first paragraph with enough words to look like real content, mentioning a <a href="/relative/link">relative link</a> inside the running text.</p>
      <p>A second paragraph that keeps the reader engaged, with enough sentences that readability keeps this block instead of discarding it as clutter, plus an illustration <img src="../images/photo.png" alt="photo"> for the reader.</p>
      <p>A third paragraph continues the story and adds detail about the subject, describing how extraction removes navigation, adverts, and other unrelated page furniture.</p>
      <p>A fourth paragraph closes the article, reminding the reader that the extracted text should keep paragraph breaks while dropping scripts and event handlers.</p>
      <script>alert("xss")</script>
    </article>
  </main>
  <footer>Footer links</footer>
</body>
</html>`

func requireErrorCode(t *testing.T, err error, want domain.ErrorCode) {
	t.Helper()

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected *domain.DomainError, got %v", err)
	}

	if domainErr.Code != want {
		t.Fatalf("expected code %s, got %s", want, domainErr.Code)
	}
}

func requireContains(t *testing.T, value string, want string) {
	t.Helper()

	if !strings.Contains(value, want) {
		t.Fatalf("expected %q to contain %q", value, want)
	}
}

func requireNotContains(t *testing.T, value string, unwanted string) {
	t.Helper()

	if strings.Contains(value, unwanted) {
		t.Fatalf("expected %q to not contain %q", value, unwanted)
	}
}

func requireTime(t *testing.T, got *time.Time, want string) {
	t.Helper()

	if got == nil {
		t.Fatalf("expected published time %s, got none", want)
	}

	expected, err := time.Parse(time.RFC3339, want)
	if err != nil {
		t.Fatalf("invalid expected time %s: %v", want, err)
	}

	if !got.Equal(expected) {
		t.Fatalf("expected published time %s, got %s", expected, got.UTC())
	}
}

func parseFeed(t *testing.T, body string, baseURL string) domain.ParsedFeed {
	t.Helper()

	feed, err := NewFeedParser(NewSanitizer()).ParseFeed([]byte(body), baseURL)
	if err != nil {
		t.Fatalf("expected feed to parse, got %v", err)
	}

	return feed
}

func TestSanitizeHTMLStripsUnsafeMarkup(t *testing.T) {
	t.Parallel()

	raw := `<div><p>Hello <script>alert("x")</script><style>p{color:red}</style></p>` +
		`<img src="/images/pic.png" alt="pic" loading="lazy" onerror="alert(1)" onload="alert(2)">` +
		`<iframe src="https://evil.example/"></iframe>` +
		`<form action="/submit"><input name="field"><button>Go</button></form>` +
		`<object data="clip.swf"></object><embed src="clip.swf">` +
		`<svg><circle r="1"></circle></svg>` +
		`<figure><figcaption>Caption</figcaption><picture><source src="/images/pic.webp" type="image/webp"><img src="/images/pic.png" alt="pic" width="120" height="80"></picture></figure>` +
		`<table><tbody><tr><td>cell</td></tr></tbody></table><pre><code>code</code></pre>` +
		`<a href="javascript:alert(1)">bad link</a></div>`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://example.com/blog/article")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	for _, unwanted := range []string{
		"<script",
		"alert(",
		"<style",
		"<iframe",
		"<form",
		"<input",
		"<button",
		"<object",
		"<embed",
		"<svg",
		"onerror",
		"onload",
		"javascript:",
	} {
		requireNotContains(t, sanitized, unwanted)
	}

	requireContains(t, sanitized, `<img src="https://example.com/images/pic.png"`)
	requireContains(t, sanitized, `loading="lazy"`)
	requireContains(t, sanitized, `bad link`)
	requireContains(t, sanitized, `<figure><figcaption>Caption</figcaption>`)
	requireContains(t, sanitized, `width="120"`)
	requireContains(t, sanitized, `height="80"`)
	requireContains(t, sanitized, `<td>cell</td>`)
	requireContains(t, sanitized, `<code>code</code>`)
}

func TestSanitizeHTMLResolvesAndRewritesURLs(t *testing.T) {
	t.Parallel()

	raw := `<a href="/posts/one">relative</a>` +
		`<a href="https://elsewhere.example/x">absolute</a>` +
		`<a href="mailto:someone@example.com">mail</a>` +
		`<a href="/overridden" target="_self" rel="nofollow">override</a>` +
		`<a href="javascript:alert(1)">bad</a>` +
		`<img src="img/pic.png">` +
		`<img src="data:image/png;base64,iVBORw0KGgo=">` +
		`<img src="data:text/html;base64,PHNjcmlwdD4=">` +
		`<video src="media/clip.mp4" controls></video>` +
		`<picture><source src="media/pic.webp" type="image/webp"><img src="media/pic.png" alt="pic"></picture>`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://example.com/blog/article")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	requireContains(t, sanitized, `<a href="https://example.com/posts/one" target="_blank" rel="noopener noreferrer">relative</a>`)
	requireContains(t, sanitized, `<a href="https://elsewhere.example/x" target="_blank" rel="noopener noreferrer">absolute</a>`)
	requireContains(t, sanitized, `<a href="mailto:someone@example.com" target="_blank" rel="noopener noreferrer">mail</a>`)
	requireContains(t, sanitized, `<a href="https://example.com/overridden"`)
	requireNotContains(t, sanitized, "_self")
	requireNotContains(t, sanitized, "nofollow")
	requireNotContains(t, sanitized, "javascript:")
	requireContains(t, sanitized, `<img src="https://example.com/blog/img/pic.png"`)
	requireContains(t, sanitized, `<img src="data:image/png;base64,iVBORw0KGgo="`)
	requireNotContains(t, sanitized, "data:text/html")
	requireContains(t, sanitized, `<video src="https://example.com/blog/media/clip.mp4" controls="">`)
	requireContains(t, sanitized, `<picture>`)
	requireContains(t, sanitized, `<source src="https://example.com/blog/media/pic.webp" type="image/webp"`)
}

func TestSanitizeHTMLStripsURLCredentials(t *testing.T) {
	t.Parallel()

	raw := `<a href="sub">relative</a>` +
		`<img src="pic.png">` +
		`<a href="https://u:p@other.example/x">absolute</a>` +
		`<img src="https://media:pw@other.example/pic.png">`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://user:secret@example.com/dir/page.html")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	requireContains(t, sanitized, `<a href="https://example.com/dir/sub"`)
	requireContains(t, sanitized, `<img src="https://example.com/dir/pic.png"`)
	requireContains(t, sanitized, `<a href="https://other.example/x"`)
	requireContains(t, sanitized, `<img src="https://other.example/pic.png"`)

	for _, credential := range []string{"user:", "secret@", "u:p@", "media:pw@", "@example.com", "@other.example"} {
		requireNotContains(t, sanitized, credential)
	}
}

func TestSanitizeHTMLReturnsEmptyForBlankInput(t *testing.T) {
	t.Parallel()

	sanitized, err := NewSanitizer().SanitizeHTML("   ", "https://example.com/")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	if sanitized != "" {
		t.Fatalf("expected empty sanitized html, got %q", sanitized)
	}
}

func TestParseFeedStripsBOM(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		body  string
		title string
	}{
		{name: "rss", body: rssFixture, title: "Example Feed"},
		{name: "rdf", body: rdfFixture, title: "RDF Feed"},
		{name: "atom", body: atomFixture, title: "Atom Feed"},
		{name: "json", body: jsonFixture, title: "JSON Feed"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			body := "\xef\xbb\xbf \n" + testCase.body
			feed := parseFeed(t, body, "https://example.com/feed")

			if feed.Title != testCase.title {
				t.Fatalf("expected title %q, got %q", testCase.title, feed.Title)
			}

			if len(feed.Entries) == 0 {
				t.Fatalf("expected parsed entries")
			}
		})
	}
}

func TestParseFeedRejectsMalformedPayload(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{name: "empty body", body: ""},
		{name: "whitespace only", body: "  \n\t "},
		{name: "bom only", body: "\xef\xbb\xbf"},
		{name: "unsupported payload", body: "not a feed"},
		{name: "truncated rss", body: `<rss version="2.0"><channel><title>Feed</title>`},
		{name: "rss trailing garbage", body: rssFixture + "garbage"},
		{name: "rss second root", body: rssFixture + "<rss/>"},
		{name: "truncated atom", body: `<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>`},
		{name: "html document", body: `<html><body><p>hello</p></body></html>`},
		{name: "truncated json", body: `{"version": "https://jsonfeed.org/version/1.1", "items": [`},
		{name: "json trailing garbage", body: jsonFixture + "{}"},
		{name: "json missing version", body: `{"title": "Feed", "items": []}`},
		{name: "json wrong version", body: `{"version": "1.0", "title": "Feed", "items": []}`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			_, err := NewFeedParser(NewSanitizer()).ParseFeed([]byte(testCase.body), "https://example.com/feed")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		})
	}
}

func TestParseFeedTitleFallsBackToHost(t *testing.T) {
	t.Parallel()

	body := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title> </title>
    <description></description>
    <link>https://example.com/</link>
    <item><title>Entry</title><link>https://example.com/entry</link></item>
  </channel>
</rss>`

	feed := parseFeed(t, body, "https://Example.COM/feed.xml")
	if feed.Title != "example.com" {
		t.Fatalf("expected title %q, got %q", "example.com", feed.Title)
	}

	if feed.Description != nil {
		t.Fatalf("expected no description, got %q", *feed.Description)
	}

	untitled := parseFeed(t, body, "")
	if untitled.Title != "Untitled" {
		t.Fatalf("expected title %q, got %q", "Untitled", untitled.Title)
	}
}

func TestParseRSSEntries(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, rssFixture, "https://example.com/feed.xml")

	if feed.Title != "Example Feed" {
		t.Fatalf("expected feed title %q, got %q", "Example Feed", feed.Title)
	}

	if feed.Description == nil || *feed.Description != "Feed description" {
		t.Fatalf("expected feed description %q", "Feed description")
	}

	if len(feed.Entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(feed.Entries))
	}

	first := feed.Entries[0]
	if first.URL.Raw() != "https://example.com/posts/first" {
		t.Fatalf("expected resolved url, got %q", first.URL.Raw())
	}

	if first.Title != "First post" {
		t.Fatalf("expected entry title %q, got %q", "First post", first.Title)
	}

	if first.Description == nil || *first.Description != "Plain description" {
		t.Fatalf("expected entry description %q", "Plain description")
	}

	if first.Content == nil || *first.Content != `<p>Rich <strong>content</strong><a href="https://example.com/posts/first#comments" target="_blank" rel="noopener noreferrer">Comments</a></p>` {
		t.Fatalf("expected content from content:encoded, got %v", first.Content)
	}

	requireTime(t, first.PublishedAt, "2006-01-02T15:04:05Z")

	second := feed.Entries[1]
	if second.Content != nil {
		t.Fatalf("expected description to never become content, got %q", *second.Content)
	}

	if second.PublishedAt != nil {
		t.Fatalf("expected no published time, got %s", second.PublishedAt)
	}
}

func TestParseRDFEntriesUseDublinCoreDate(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, rdfFixture, "https://example.com/feed.rdf")

	if feed.Title != "RDF Feed" {
		t.Fatalf("expected feed title %q, got %q", "RDF Feed", feed.Title)
	}

	if len(feed.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(feed.Entries))
	}

	entry := feed.Entries[0]
	if entry.URL.Raw() != "https://example.com/rdf/one" {
		t.Fatalf("expected resolved url, got %q", entry.URL.Raw())
	}

	if entry.Description == nil || *entry.Description != "RDF entry description" {
		t.Fatalf("expected entry description %q", "RDF entry description")
	}

	if entry.Content == nil || *entry.Content != "<p>RDF rich content</p>" {
		t.Fatalf("expected content from content:encoded, got %v", entry.Content)
	}

	requireTime(t, entry.PublishedAt, "2021-03-04T05:06:07Z")
}

func TestParseAtomEntries(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, atomFixture, "https://example.com/atom.xml")

	if feed.Title != "Atom Feed" {
		t.Fatalf("expected feed title %q, got %q", "Atom Feed", feed.Title)
	}

	if feed.Description == nil || *feed.Description != "Atom subtitle" {
		t.Fatalf("expected feed description from subtitle")
	}

	if len(feed.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(feed.Entries))
	}

	first := feed.Entries[0]
	if first.URL.Raw() != "https://example.com/entries/typed" {
		t.Fatalf("expected text/html alternate link, got %q", first.URL.Raw())
	}

	if first.Description == nil || *first.Description != "Tom &amp; Jerry &lt;b&gt;bold&lt;/b&gt;" {
		t.Fatalf("expected escaped plain text summary, got %v", first.Description)
	}

	if first.Content == nil || *first.Content != "<p>Atom content &amp; more</p>" {
		t.Fatalf("expected sanitized html content, got %v", first.Content)
	}

	requireTime(t, first.PublishedAt, "2022-01-02T03:04:05Z")

	second := feed.Entries[1]
	if second.URL.Raw() != "https://example.com/entries/two" {
		t.Fatalf("expected untyped alternate link, got %q", second.URL.Raw())
	}

	if second.Description == nil || *second.Description != "Plain &amp; untyped summary" {
		t.Fatalf("expected escaped untyped summary, got %v", second.Description)
	}

	if second.Content != nil {
		t.Fatalf("expected content[src] to be ignored, got %q", *second.Content)
	}

	if second.PublishedAt != nil {
		t.Fatalf("expected updated to be ignored, got %s", second.PublishedAt)
	}

	third := feed.Entries[2]
	if third.URL.Raw() != "https://example.com/entries/three" {
		t.Fatalf("expected other alternate link, got %q", third.URL.Raw())
	}

	if third.Content == nil || *third.Content != "Text &lt;i&gt;content&lt;/i&gt;" {
		t.Fatalf("expected escaped plain text content, got %v", third.Content)
	}

	if third.Description != nil {
		t.Fatalf("expected no description, got %q", *third.Description)
	}
}

func TestParseFeedStripsURLCredentials(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, credentialedRSSFixture, "https://user:secret@example.com/feed.xml")

	if len(feed.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(feed.Entries))
	}

	entry := feed.Entries[0]
	if !entry.URL.HasCredentials() {
		t.Fatalf("expected credentials to stay on the stored entry url, got %q", entry.URL.RedactedString())
	}

	if entry.URL.RedactedString() != "https://example.com/posts/one" {
		t.Fatalf("expected redacted entry url, got %q", entry.URL.RedactedString())
	}

	if entry.Description == nil {
		t.Fatalf("expected description to be sanitized")
	}

	if entry.Content == nil {
		t.Fatalf("expected content to be sanitized")
	}

	requireContains(t, *entry.Description, `href="https://example.com/about"`)
	requireContains(t, *entry.Content, `href="https://example.com/secret"`)
	requireContains(t, *entry.Content, `src="https://example.com/pic.png"`)

	for _, credential := range []string{"user:", "secret@", "entry:pw@", "@example.com"} {
		requireNotContains(t, *entry.Description, credential)
		requireNotContains(t, *entry.Content, credential)
	}
}

func TestParseAtomSummaryTypeSlotsAlign(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, atomSummarySlotsFixture, "https://example.com/atom.xml")

	if len(feed.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(feed.Entries))
	}

	if feed.Entries[0].Description != nil {
		t.Fatalf("expected entry without summary to keep no description, got %q", *feed.Entries[0].Description)
	}

	if feed.Entries[1].Description == nil || *feed.Entries[1].Description != "<p>Rich</p>" {
		t.Fatalf("expected html summary to keep markup, got %v", feed.Entries[1].Description)
	}

	if feed.Entries[2].Description == nil || *feed.Entries[2].Description != "1 &lt; 2" {
		t.Fatalf("expected text summary to stay escaped, got %v", feed.Entries[2].Description)
	}
}

func TestParseJSONFeedEntries(t *testing.T) {
	t.Parallel()

	feed := parseFeed(t, jsonFixture, "https://example.com/feed.json")

	if feed.Title != "JSON Feed" {
		t.Fatalf("expected feed title %q, got %q", "JSON Feed", feed.Title)
	}

	if feed.Description == nil || *feed.Description != "JSON description" {
		t.Fatalf("expected feed description %q", "JSON description")
	}

	if len(feed.Entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(feed.Entries))
	}

	first := feed.Entries[0]
	if first.URL.Raw() != "https://example.com/json/one" {
		t.Fatalf("expected url resolved from url field, got %q", first.URL.Raw())
	}

	if first.Description == nil || *first.Description != "Summary &amp; &lt;b&gt;bold&lt;/b&gt;" {
		t.Fatalf("expected escaped summary, got %v", first.Description)
	}

	if first.Content == nil || *first.Content != "<p>HTML content</p>" {
		t.Fatalf("expected content_html preferred over content_text, got %v", first.Content)
	}

	requireTime(t, first.PublishedAt, "2024-05-06T07:08:09Z")

	second := feed.Entries[1]
	if second.Content == nil || *second.Content != "Plain &amp; &lt;i&gt;text&lt;/i&gt;" {
		t.Fatalf("expected escaped content_text, got %v", second.Content)
	}

	if second.PublishedAt != nil {
		t.Fatalf("expected unparseable date to stay absent, got %s", second.PublishedAt)
	}
}

func TestParseFeedDropsEntriesWithoutValidURL(t *testing.T) {
	t.Parallel()

	rssBody := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item><title>Script link</title><link>javascript:alert(1)</link></item>
    <item><title>Relative link</title><link>/kept</link></item>
    <item><title>FTP link</title><link>ftp://example.com/file</link></item>
  </channel>
</rss>`

	feed := parseFeed(t, rssBody, "https://example.com/feed.xml")
	if len(feed.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(feed.Entries))
	}

	if feed.Entries[0].URL.Raw() != "https://example.com/kept" {
		t.Fatalf("expected kept entry url, got %q", feed.Entries[0].URL.Raw())
	}

	atomBody := `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed</title>
  <entry><title>Self only</title><link rel="self" href="https://example.com/self"/></entry>
  <entry><title>Enclosure only</title><link rel="enclosure" href="https://example.com/audio.mp3"/></entry>
</feed>`

	atomFeed := parseFeed(t, atomBody, "https://example.com/atom.xml")
	if len(atomFeed.Entries) != 0 {
		t.Fatalf("expected non-alternate links to be ignored, got %d entries", len(atomFeed.Entries))
	}
}

func TestParseFeedSkipsEntryWhenSanitizeFails(t *testing.T) {
	t.Parallel()

	body := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Feed</title>
    <item><title>Broken</title><link>https://example.com/broken</link><description>boom</description></item>
    <item><title>Fine</title><link>https://example.com/fine</link><description>fine</description></item>
  </channel>
</rss>`

	parser := NewFeedParser(failingSanitizer{failOn: "boom"})
	feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.xml")
	if err != nil {
		t.Fatalf("expected feed to parse, got %v", err)
	}

	if len(feed.Entries) != 1 {
		t.Fatalf("expected 1 kept entry, got %d", len(feed.Entries))
	}

	if feed.Entries[0].Title != "Fine" {
		t.Fatalf("expected the sanitizable entry to be kept, got %q", feed.Entries[0].Title)
	}
}

func TestParseAtomIgnoresExtensionEntryAndSummaryElements(t *testing.T) {
	t.Parallel()

	payload := `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:ext="https://example.com/ext">
  <title>Ext Atom</title>
  <ext:entry>
    <ext:summary type="html">&lt;b&gt;Ext&lt;/b&gt;</ext:summary>
  </ext:entry>
  <entry>
    <title>First</title>
    <link href="https://example.com/1"/>
    <ext:summary type="html">&lt;b&gt;Ignored&lt;/b&gt;</ext:summary>
    <summary type="text">1 &lt; 2</summary>
  </entry>
  <entry>
    <title>Second</title>
    <link href="https://example.com/2"/>
    <summary type="html">&lt;p&gt;Rich&lt;/p&gt;</summary>
  </entry>
</feed>`

	feed := parseFeed(t, payload, "https://example.com/feed.atom")
	if len(feed.Entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(feed.Entries))
	}

	if feed.Entries[0].Description == nil || *feed.Entries[0].Description != "1 &lt; 2" {
		t.Fatalf("entry 0 description = %v, want %q", feed.Entries[0].Description, "1 &lt; 2")
	}

	if feed.Entries[1].Description == nil || *feed.Entries[1].Description != "<p>Rich</p>" {
		t.Fatalf("entry 1 description = %v, want %q", feed.Entries[1].Description, "<p>Rich</p>")
	}
}

func TestParseAtomRequiresEmptyNamespaceForTypeAttr(t *testing.T) {
	t.Parallel()

	payload := `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:ext="https://example.com/ext">
  <title>Namespaced Type</title>
  <entry>
    <title>Namespaced only</title>
    <link href="https://example.com/1"/>
    <summary ext:type="html">&lt;b&gt;Summary&lt;/b&gt;</summary>
    <content ext:type="html">&lt;b&gt;Content&lt;/b&gt;</content>
  </entry>
  <entry>
    <title>Both present</title>
    <link href="https://example.com/2"/>
    <summary ext:type="text" type="html">&lt;p&gt;Summary&lt;/p&gt;</summary>
    <content ext:type="text" type="html">&lt;p&gt;Content&lt;/p&gt;</content>
  </entry>
</feed>`

	feed := parseFeed(t, payload, "https://example.com/feed.atom")
	if len(feed.Entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(feed.Entries))
	}

	first := feed.Entries[0]
	if first.Description == nil || *first.Description != "&lt;b&gt;Summary&lt;/b&gt;" {
		t.Fatalf("first description = %v, want escaped summary", first.Description)
	}

	if first.Content == nil || *first.Content != "&lt;b&gt;Content&lt;/b&gt;" {
		t.Fatalf("first content = %v, want escaped content", first.Content)
	}

	second := feed.Entries[1]
	if second.Description == nil || *second.Description != "<p>Summary</p>" {
		t.Fatalf("second description = %v, want html summary", second.Description)
	}

	if second.Content == nil || *second.Content != "<p>Content</p>" {
		t.Fatalf("second content = %v, want html content", second.Content)
	}
}

func TestSanitizeHTMLBudgetAndXSSVectors(t *testing.T) {
	t.Parallel()

	sanitizer := NewSanitizer()

	// Relative URL expansion exceeding budget fails cleanly.
	raw := strings.Repeat(`<a href="/x">link</a>`, 20)
	longBase := "https://example.com/" + strings.Repeat("a", 64) + "/"
	if _, err := sanitizer.sanitizeHTMLWithBudget(raw, longBase, 512); err == nil {
		t.Fatal("expected budget overflow error, got nil")
	}

	// XSS vectors remain stripped with single bluemonday pass.
	xss := `<p>ok</p><svg><script>alert(1)</script></svg><math><mtext></mtext></math>` +
		`<noscript><img src=x onerror=alert(2)></noscript>` +
		`<a href="javascript:alert(3)" onclick="alert(4)">click</a>` +
		`<img src="vbscript:msgbox(1)">` +
		`<a href="https://example.com/good" onmouseover="alert(5)">good</a>`
	sanitized, err := sanitizer.SanitizeHTML(xss, "https://example.com/")
	if err != nil {
		t.Fatalf("SanitizeHTML() error = %v", err)
	}

	for _, vector := range []string{"<script", "<svg", "<math", "<noscript", "onerror", "onclick", "onmouseover", "javascript:", "vbscript:", "alert("} {
		requireNotContains(t, sanitized, vector)
	}

	requireContains(t, sanitized, `<a href="https://example.com/good" target="_blank" rel="noopener noreferrer">good</a>`)
}

func TestExtractArticle(t *testing.T) {
	t.Parallel()

	article, err := NewArticleExtractor(NewSanitizer()).ExtractArticle(articleFixture, "https://example.com/posts/article")
	if err != nil {
		t.Fatalf("expected article to extract, got %v", err)
	}

	if article.Title != "Readable article" {
		t.Fatalf("expected article title from document title, got %q", article.Title)
	}

	requireContains(t, article.Content, `href="https://example.com/relative/link" target="_blank" rel="noopener noreferrer"`)
	requireContains(t, article.Content, `src="https://example.com/images/photo.png"`)
	requireContains(t, article.Content, "A first paragraph with enough words")
	requireNotContains(t, article.Content, "alert(")
	requireNotContains(t, article.Content, "Footer links")

	if article.Description == nil || *article.Description != "Excerpt &amp; summary of the article." {
		t.Fatalf("expected sanitized excerpt, got %v", article.Description)
	}

	requireTime(t, article.PublishedAt, "2020-02-03T04:05:06Z")
}

func TestExtractArticleRejectsEmptyContent(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{name: "empty body", body: ""},
		{name: "whitespace body", body: "  \n\t "},
		{name: "no readable content", body: "<html><head><title>Empty</title></head><body></body></html>"},
	}

	extractor := NewArticleExtractor(NewSanitizer())

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			_, err := extractor.ExtractArticle(testCase.body, "https://example.com/posts/article")
			requireErrorCode(t, err, domain.ErrArticleEmptyContent)
		})
	}
}

func TestExtractArticleRejectsInvalidPageURL(t *testing.T) {
	t.Parallel()

	_, err := NewArticleExtractor(NewSanitizer()).ExtractArticle(articleFixture, "://invalid")
	requireErrorCode(t, err, domain.ErrArticleExtractorError)
}

type failingSanitizer struct {
	failOn string
}

func (f failingSanitizer) SanitizeHTML(rawHTML string, baseURL string) (string, error) {
	if strings.Contains(rawHTML, f.failOn) {
		return "", errors.New("sanitizer rejected html")
	}

	return "<p>sanitized</p>", nil
}

func TestSanitizeHTMLRemovesUnusedURLAttrsAndRestrictsDataURLs(t *testing.T) {
	t.Parallel()

	raw := `<map name="m"><area shape="rect" coords="0,0,10,10" href="https://user:pw@example.com/area"></map>` +
		`<img src="/pic.png" usemap="#m">` +
		`<blockquote cite="https://user:pw@example.com/quote"><p>quote</p></blockquote>` +
		`<q cite="https://user:pw@example.com/q">short</q>` +
		`<del cite="https://user:pw@example.com/del">old</del>` +
		`<ins cite="https://user:pw@example.com/ins">new</ins>` +
		`<a href="data:image/png;base64,iVBORw0KGgo=">data link</a>` +
		`<video src="data:image/png;base64,iVBORw0KGgo=" controls></video>` +
		`<audio src="data:image/png;base64,iVBORw0KGgo=" controls></audio>` +
		`<picture><source src="data:image/png;base64,iVBORw0KGgo=" type="image/png"><img src="data:image/png;base64,iVBORw0KGgo="></picture>` +
		`<a href="mailto://user:pw@example.com">bad mailto</a>` +
		`<source src="https://media:pw@example.com/clip.mp4" type="video/mp4">` +
		`<video src="https://vid:pw@example.com/clip.mp4"></video>` +
		`<audio src="https://aud:pw@example.com/clip.mp3"></audio>`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://baseuser:basepw@example.com/dir/post")
	if err != nil {
		t.Fatalf("SanitizeHTML() error = %v", err)
	}

	for _, unwanted := range []string{
		"<map",
		"<area",
		"usemap",
		"cite=",
		"user:",
		"pw@",
		"baseuser:",
		"basepw@",
		"media:",
		"vid:",
		"aud:",
		`<a href="data:`,
		`<video src="data:`,
		`<audio src="data:`,
		`<source src="data:`,
		"mailto://",
	} {
		requireNotContains(t, sanitized, unwanted)
	}

	requireContains(t, sanitized, "<blockquote><p>quote</p></blockquote>")
	requireContains(t, sanitized, "<q>short</q>")
	requireContains(t, sanitized, "<del>old</del>")
	requireContains(t, sanitized, "<ins>new</ins>")
	requireContains(t, sanitized, `<img src="https://example.com/pic.png"`)
	requireContains(t, sanitized, `<img src="data:image/png;base64,iVBORw0KGgo="`)
	requireContains(t, sanitized, `<video src="https://example.com/clip.mp4"`)
	requireContains(t, sanitized, `<audio src="https://example.com/clip.mp3"`)
}

func TestParseFeedRejectsExcessiveXMLDepth(t *testing.T) {
	t.Parallel()

	buildDeepRSS := func(extraDepth int) string {
		openTags := strings.Repeat("<ext:wrap>", extraDepth)
		closeTags := strings.Repeat("</ext:wrap>", extraDepth)

		return `<?xml version="1.0" encoding="UTF-8"?>` +
			`<rss version="2.0" xmlns:ext="https://example.com/ext"><channel><title>Deep</title>` +
			`<item><title>Item</title><link>https://example.com/1</link>` +
			openTags + `<ext:leaf>x</ext:leaf>` + closeTags +
			`</item></channel></rss>`
	}

	parser := NewFeedParser(NewSanitizer())

	// Depth = rss(1) -> channel(2) -> item(3) -> 60 wraps(63) -> leaf(64) fits maxFeedXMLDepth(64).
	if _, err := parser.ParseFeed([]byte(buildDeepRSS(60)), "https://example.com/feed.xml"); err != nil {
		t.Fatalf("expected depth 64 to succeed, got %v", err)
	}

	// Depth = 65 exceeds maxFeedXMLDepth(64).
	if _, err := parser.ParseFeed([]byte(buildDeepRSS(61)), "https://example.com/feed.xml"); err == nil {
		t.Fatal("expected depth 65 to fail, got nil")
	} else {
		requireErrorCode(t, err, domain.ErrFeedParserError)
	}
}

func TestParseFeedLimitsItemCount(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())
	limits := feedLimits{maxItems: 3, maxOutputBytes: 64 * 1024}

	t.Run("rss", func(t *testing.T) {
		var items strings.Builder
		for i := range 4 {
			fmt.Fprintf(&items, `<item><title>Item %d</title><link>https://example.com/%d</link></item>`, i, i)
		}

		body := `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>` + items.String() + `</channel></rss>`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})

	t.Run("atom", func(t *testing.T) {
		var entries strings.Builder
		for i := range 4 {
			fmt.Fprintf(&entries, `<entry><title>Item %d</title><link href="https://example.com/%d"/></entry>`, i, i)
		}

		body := `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>` + entries.String() + `</feed>`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/atom.xml", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})

	t.Run("json", func(t *testing.T) {
		var items []string
		for i := range 4 {
			items = append(items, fmt.Sprintf(`{"url":"https://example.com/%d","title":"Item %d"}`, i, i))
		}

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Feed","items":[` + strings.Join(items, ",") + `]}`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.json", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})
}

type streamingJSONFeedReader struct {
	totalItems   int
	itemsEmitted int
	bytesRead    int
	buf          []byte
	offset       int
	closed       bool
}

func newStreamingJSONFeedReader(totalItems int) *streamingJSONFeedReader {
	return &streamingJSONFeedReader{
		totalItems: totalItems,
		buf:        []byte(`{"version":"https://jsonfeed.org/version/1.1","title":"Feed","items":[`),
	}
}

func (r *streamingJSONFeedReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.buf) {
		if r.closed {
			return 0, io.EOF
		}

		r.offset = 0
		if r.itemsEmitted < r.totalItems {
			prefix := ""
			if r.itemsEmitted > 0 {
				prefix = ","
			}

			r.buf = fmt.Appendf(r.buf[:0], `%s{"url":"https://example.com/%d","title":"Item %d"}`, prefix, r.itemsEmitted, r.itemsEmitted)
			r.itemsEmitted++
		} else {
			r.buf = append(r.buf[:0], "]}"...)
			r.closed = true
		}
	}

	n := copy(p, r.buf[r.offset:])
	r.offset += n
	r.bytesRead += n

	return n, nil
}

func TestParseJSONFeedAbortsEarlyOnItemLimit(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())
	base := parseBaseURL("https://example.com/feed.json")

	const totalItems = 100_000
	for _, maxItems := range []int{3, maxFeedItems} {
		t.Run(fmt.Sprintf("maxItems_%d", maxItems), func(t *testing.T) {
			t.Parallel()

			reader := newStreamingJSONFeedReader(totalItems)
			limits := feedLimits{maxItems: maxItems, maxOutputBytes: maxFeedOutputBytes}

			parsed, err := parser.parseJSONFeedReader(reader, base, limits)
			requireErrorCode(t, err, domain.ErrFeedParserError)

			if len(parsed.Entries) != 0 {
				t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
			}

			if reader.itemsEmitted > maxItems+64 {
				t.Fatalf("expected streaming abort near limit %d, but reader emitted %d of %d items", maxItems, reader.itemsEmitted, totalItems)
			}

			if reader.bytesRead >= 128*1024 {
				t.Fatalf("expected bounded read before abort, read %d bytes", reader.bytesRead)
			}
		})
	}
}

func TestParseJSONFeedEdgeCases(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	t.Run("items before header fields", func(t *testing.T) {
		t.Parallel()

		body := `{"items":[{"url":"https://example.com/1","title":"One"}],"description":"Desc","title":"Before Header","version":"https://jsonfeed.org/version/1.1"}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if feed.Title != "Before Header" || feed.Description == nil || *feed.Description != "Desc" || len(feed.Entries) != 1 {
			t.Fatalf("unexpected parsed feed: %+v", feed)
		}
	})

	t.Run("null items array", func(t *testing.T) {
		t.Parallel()

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Empty","items":null}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if len(feed.Entries) != 0 {
			t.Fatalf("expected 0 entries, got %d", len(feed.Entries))
		}
	})

	t.Run("skips unknown nested fields", func(t *testing.T) {
		t.Parallel()

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Ext","expired":true,"authors":[{"name":"Alice"}],"_ext":{"nested":[1,true,{"k":"v"}]},"items":[{"url":"https://example.com/1","title":"One"}]}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if len(feed.Entries) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(feed.Entries))
		}
	})

	t.Run("rejects null item element and non-array items", func(t *testing.T) {
		t.Parallel()

		for _, body := range []string{
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","items":[null]}`,
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","items":"oops"}`,
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":[null],"items":[]}`,
		} {
			_, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		}
	})
}

func TestParseFeedCumulativeOutputBudgetFailsWholeFeed(t *testing.T) {
	t.Parallel()

	var items strings.Builder
	chunk := `<p>` + strings.Repeat("a", 120) + `</p>`
	for i := range 5 {
		fmt.Fprintf(
			&items,
			`<item><title>Item %d</title><link>https://example.com/%d</link><description><![CDATA[%s]]></description></item>`,
			i,
			i,
			chunk,
		)
	}

	body := `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>` + items.String() + `</channel></rss>`

	t.Run("concrete sanitizer", func(t *testing.T) {
		parser := NewFeedParser(NewSanitizer())
		// Each item alone fits 400 bytes, but 5 items cumulatively exceed 400 bytes.
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", feedLimits{
			maxItems:       10,
			maxOutputBytes: 400,
		})
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries, got %d", len(parsed.Entries))
		}
	})

	t.Run("custom sanitizer interface", func(t *testing.T) {
		parser := NewFeedParser(failingSanitizer{failOn: "never"})
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", feedLimits{
			maxItems:       10,
			maxOutputBytes: 80,
		})
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries, got %d", len(parsed.Entries))
		}
	})
}

func TestExtractArticleRenderHTMLBound(t *testing.T) {
	t.Parallel()

	article, err := extractReadableArticle(articleFixture, "https://example.com/posts/article")
	if err != nil {
		t.Fatalf("extractReadableArticle() error = %v", err)
	}

	extractor := NewArticleExtractor(NewSanitizer())
	_, err = extractor.renderSanitizedArticleWithLimit(article, "https://example.com/posts/article", 64)
	requireErrorCode(t, err, domain.ErrArticleExtractorError)
}
