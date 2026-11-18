/** One document per format, with the shapes FD-PARSE has to read. */

export const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>News</title>
    <description>Daily</description>
    <item>
      <title>First</title>
      <link>https://example.com/a</link>
      <pubDate>Wed, 01 Jan 2026 00:00:00 GMT</pubDate>
      <description>Summary</description>
      <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
    </item>
    <item>
      <title>Relative</title>
      <link>/b</link>
    </item>
    <item>
      <title>Ftp</title>
      <link>ftp://example.com/file</link>
    </item>
    <item>
      <title>Script</title>
      <link>javascript:alert(1)</link>
    </item>
    <item>
      <title>Blank</title>
      <link>   </link>
    </item>
    <item>
      <title>Linkless</title>
    </item>
    <item>
      <title>Again</title>
      <link>https://example.com/a</link>
    </item>
  </channel>
</rss>`;

export const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom News</title>
  <subtitle>Updates</subtitle>
  <entry>
    <title>Entry</title>
    <link rel="self" type="text/html" href="https://example.com/self"/>
    <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/>
    <link rel="alternate" type="text/html" href="https://example.com/e"/>
    <link href="https://example.com/untyped"/>
    <published>2026-01-02T00:00:00Z</published>
    <summary type="text">Plain summary</summary>
    <content type="html">&lt;p&gt;Body&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Self only</title>
    <id>https://example.com/self-entry</id>
    <link rel="self" href="https://example.com/self"/>
  </entry>
  <entry>
    <title>Untyped</title>
    <link href="https://example.com/t"/>
    <content type="text">plain body</content>
  </entry>
</feed>`;

export const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel rdf:about="https://example.com/">
    <title>RDF News</title>
    <link>https://example.com/</link>
    <description>RDF daily</description>
  </channel>
  <item rdf:about="https://example.com/r">
    <title>R</title>
    <link>https://example.com/r</link>
    <dc:date>2026-01-04T00:00:00Z</dc:date>
    <description>rdf summary</description>
    <content:encoded>&lt;p&gt;rdf body&lt;/p&gt;</content:encoded>
  </item>
  <item rdf:about="https://example.com/s">
    <title>S</title>
    <link>https://example.com/s</link>
    <dc:date>2026-01-05T00:00:00Z</dc:date>
    <dc:date>2026-01-06T00:00:00Z</dc:date>
  </item>
</rdf:RDF>`;

export const jsonFeed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON News',
  description: 'J',
  items: [
    {
      id: '1',
      url: 'https://example.com/j1',
      title: 'J1',
      summary: 'sum',
      content_text: 'body',
      date_published: '2026-01-03T00:00:00Z',
    },
    {
      id: '2',
      external_url: 'https://example.com/external',
      title: 'J2',
      content_html: '<p>rich</p>',
    },
    {
      id: '3',
      url: 'https://example.com/j3',
      title: 'J3',
      content_html: '<p>rich</p>',
      content_text: 'plain',
      date_modified: '2026-01-07T00:00:00Z',
    },
  ],
});
