package content

import (
	"reader/internal/domain"
	"testing"
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
	cases := []struct {
		name, payload          string
		descriptions, contents []*string
	}{
		{name: "summary slots", payload: atomSummarySlotsFixture, descriptions: []*string{nil, atomText("<p>Rich</p>"), atomText("1 &lt; 2")}},
		{name: "extension elements", payload: `<?xml version="1.0" encoding="utf-8"?>
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
</feed>`, descriptions: []*string{atomText("1 &lt; 2"), atomText("<p>Rich</p>")}},
		{name: "namespaced type attributes", payload: `<?xml version="1.0" encoding="utf-8"?>
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
</feed>`, descriptions: []*string{atomText("&lt;b&gt;Summary&lt;/b&gt;"), atomText("<p>Summary</p>")}, contents: []*string{atomText("&lt;b&gt;Content&lt;/b&gt;"), atomText("<p>Content</p>")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			feed := parseFeed(t, tc.payload, "https://example.com/feed.atom")
			if len(feed.Entries) != len(tc.descriptions) {
				t.Fatalf("got %d entries, want %d", len(feed.Entries), len(tc.descriptions))
			}
			for i, want := range tc.descriptions {
				got := feed.Entries[i].Description
				if (got == nil) != (want == nil) || got != nil && *got != *want {
					t.Fatalf("entry %d description = %v, want %v", i, got, want)
				}
				if tc.contents != nil {
					got, want = feed.Entries[i].Content, tc.contents[i]
					if got == nil || *got != *want {
						t.Fatalf("entry %d content = %v, want %v", i, got, want)
					}
				}
			}
		})
	}
}

func atomText(value string) *string { return &value }

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
