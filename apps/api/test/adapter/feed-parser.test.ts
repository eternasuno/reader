import { expect, it } from '@effect/vitest';
import { DateTime, Effect } from 'effect';
import { FeedParser } from '../../../../packages/business/src/port/feed-parser.ts';
import { FeedParserLive, parseFeed } from '../../src/adapter/feed-parser';

const base = new URL('https://example.com/feed.xml');

const iso = (value: DateTime.Utc | undefined) =>
  value === undefined ? undefined : DateTime.formatIso(value);

const rss = `<?xml version="1.0"?>
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
      <title>Unsafe</title>
      <link>javascript:alert(1)</link>
    </item>
    <item>
      <title>  Linkless  </title>
    </item>
  </channel>
</rss>`;

it('retains RSS items with missing or invalid URLs and resolves relative links', () => {
  const feed = parseFeed(rss, base);
  expect(feed.title).toBe('News');
  expect(feed.description).toBe('Daily');
  expect(feed.articles).toHaveLength(4);
  const [first, second, third, linkless] = feed.articles;
  expect(first).toMatchObject({
    title: 'First',
    description: 'Summary',
    content: '<p>Body</p>',
  });
  expect(first?.url?.href).toBe('https://example.com/a');
  expect(iso(first?.publishedAt)).toBe('2026-01-01T00:00:00.000Z');
  expect(second?.url?.href).toBe('https://example.com/b');
  expect(second?.publishedAt).toBeUndefined();
  expect(third).toMatchObject({ title: 'Unsafe' });
  expect(third?.url).toBeUndefined();
  expect(linkless).toMatchObject({ title: 'Linkless' });
  expect(linkless?.url).toBeUndefined();
});

it('resolves relative links against the redirected feed url and drops credentialed links', () => {
  const redirected = new URL('https://mirror.example.com/feeds/news.xml');
  const xml = `<rss version="2.0">
    <channel>
      <title>Moved</title>
      <item>
        <title>Relative</title>
        <link>../story</link>
      </item>
      <item>
        <title>Credentials</title>
        <link>https://alice:secret@example.com/private</link>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(xml, redirected);
  expect(feed.articles[0]?.url?.href).toBe('https://mirror.example.com/story');
  expect(feed.articles[1]?.url).toBeUndefined();
});

it('uses only pubDate for RSS dates', () => {
  const dated = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <title>News</title>
      <item>
        <title>Dated</title>
        <dc:date>2026-01-05T00:00:00Z</dc:date>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(dated, base);
  expect(iso(feed.articles[0]?.publishedAt)).toBeUndefined();
});

it('falls back to Untitled for missing entry and feed titles', () => {
  const untitled = `<rss version="2.0">
    <channel>
      <item>
        <title>   </title>
        <description>No title</description>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(untitled, base);
  expect(feed.title).toBe('Untitled');
  expect(feed.articles[0]).toMatchObject({ title: 'Untitled' });
});

it('maps Atom entries and normalizes plain summaries and content', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Atom News</title>
    <subtitle>Updates</subtitle>
    <entry>
      <title>Entry</title>
      <link rel="alternate" href="https://example.com/e"/>
      <published>2026-01-02T00:00:00Z</published>
      <summary type="text">Plain summary</summary>
      <content type="html">&lt;p&gt;Body&lt;/p&gt;</content>
    </entry>
    <entry>
      <title>Text entry</title>
      <link href="https://example.com/t"/>
      <content type="text">plain body</content>
    </entry>
    <entry>
      <title>Mixed entry</title>
      <summary type="html">&lt;b&gt;bold&lt;/b&gt;</summary>
      <content type="text">plain</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(feed.title).toBe('Atom News');
  expect(feed.description).toBe('Updates');
  const [entry, text, mixed] = feed.articles;
  expect(entry).toMatchObject({
    title: 'Entry',
    description: 'Plain summary',
    content: '<p>Body</p>',
  });
  expect(entry?.url?.href).toBe('https://example.com/e');
  expect(iso(entry?.publishedAt)).toBe('2026-01-02T00:00:00.000Z');
  expect(text).toMatchObject({
    content: 'plain body',
  });
  expect(text?.url?.href).toBe('https://example.com/t');
  expect(mixed).toMatchObject({
    description: '<b>bold</b>',
    content: 'plain',
  });
});

it('normalizes Atom content and summaries without a media type as plain text', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Untyped</title>
    <entry>
      <title>Default summary</title>
      <summary>plain summary</summary>
    </entry>
    <entry>
      <title>Default content</title>
      <content>plain content</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  const [summary, content] = feed.articles;
  expect(summary).toMatchObject({
    description: 'plain summary',
  });
  expect(summary?.content).toBeUndefined();
  expect(content).toMatchObject({
    content: 'plain content',
  });
});

it('uses only published for Atom dates', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Dates</title>
    <entry>
      <title>Updated</title>
      <updated>2026-01-06T00:00:00Z</updated>
    </entry>
    <entry>
      <title>Published</title>
      <published>2026-01-07T00:00:00Z</published>
      <updated>2026-01-08T00:00:00Z</updated>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(iso(feed.articles[0]?.publishedAt)).toBeUndefined();
  expect(iso(feed.articles[1]?.publishedAt)).toBe('2026-01-07T00:00:00.000Z');
});

it('prefers Atom alternate links with HTML media types and then without a type', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Links</title>
    <entry>
      <title>Preferred</title>
      <link rel="self" type="text/html" href="https://example.com/self"/>
      <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/>
      <link rel="alternate" type="text/html" href="https://example.com/html"/>
      <link href="https://example.com/untyped"/>
    </entry>
    <entry>
      <title>Untyped</title>
      <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/>
      <link href="https://example.com/untyped"/>
    </entry>
    <entry>
      <title>Fallback</title>
      <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  const [preferred, untyped, fallback] = feed.articles;
  expect(preferred?.url?.href).toBe('https://example.com/html');
  expect(untyped?.url?.href).toBe('https://example.com/untyped');
  expect(fallback?.url?.href).toBe('https://example.com/xhtml');
});

it('maps Atom content and summary media types and drops external or unsupported content', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Media</title>
    <entry>
      <title>HTML</title>
      <summary type="text/html">&lt;i&gt;summary&lt;/i&gt;</summary>
      <content type="text/html">&lt;p&gt;html&lt;/p&gt;</content>
    </entry>
    <entry>
      <title>XHTML</title>
      <content type="application/xhtml+xml"><div xmlns="http://www.w3.org/1999/xhtml"><p>xhtml</p></div></content>
    </entry>
    <entry>
      <title>Plain</title>
      <content type="text/plain">text/plain</content>
    </entry>
    <entry>
      <title>External</title>
      <content type="text/html" src="https://example.com/external.html">&lt;p&gt;ignored&lt;/p&gt;</content>
    </entry>
    <entry>
      <title>Binary</title>
      <content type="image/png">cG5n</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(feed.articles).toHaveLength(5);
  const [html, xhtml, plain, external, binary] = feed.articles;
  expect(html).toMatchObject({
    description: '<i>summary</i>',
    content: '<p>html</p>',
  });
  expect(xhtml).toMatchObject({ content: '<p>xhtml</p>' });
  expect(plain).toMatchObject({ content: 'text/plain' });
  expect(external?.content).toBeUndefined();
  expect(binary?.content).toBeUndefined();
});

it('uses only date_published for JSON Feed dates', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Dates',
    items: [
      { id: '1', title: 'Modified', date_modified: '2026-01-09T00:00:00Z' },
      {
        id: '2',
        title: 'Published',
        date_published: '2026-01-10T00:00:00Z',
        date_modified: '2026-01-11T00:00:00Z',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expect(iso(feed.articles[0]?.publishedAt)).toBeUndefined();
  expect(iso(feed.articles[1]?.publishedAt)).toBe('2026-01-10T00:00:00.000Z');
});

it('maps JSON Feed items without using external_url', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON News',
    description: 'J',
    items: [
      {
        id: '1',
        url: 'https://example.com/j',
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
    ],
  });
  const feed = parseFeed(json, base);
  expect(feed.title).toBe('JSON News');
  expect(feed.description).toBe('J');
  expect(feed.articles[0]).toMatchObject({
    title: 'J1',
    description: 'sum',
    content: 'body',
  });
  expect(iso(feed.articles[0]?.publishedAt)).toBe('2026-01-03T00:00:00.000Z');
  expect(feed.articles[1]).toMatchObject({
    title: 'J2',
    content: '<p>rich</p>',
  });
  expect(feed.articles[1]?.url).toBeUndefined();
});

it('maps RDF items to raw entries', () => {
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
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
    </item>
  </rdf:RDF>`;
  const feed = parseFeed(rdf, base);
  expect(feed.title).toBe('RDF News');
  expect(feed.description).toBe('RDF daily');
  expect(feed.articles[0]).toMatchObject({
    title: 'R',
    description: 'rdf summary',
  });
  expect(iso(feed.articles[0]?.publishedAt)).toBe('2026-01-04T00:00:00.000Z');
});

it('rejects declarations and unparseable documents', () => {
  expect(() => parseFeed('<!DOCTYPE rss><rss/>', base)).toThrow(
    'Unsupported XML declarations'
  );
  expect(() => parseFeed('<html></html>', base)).toThrow();
});

it('rejects document type and entity declarations outside skipped markup', () => {
  const internalSubset = `<?xml version="1.0"?>
<!DOCTYPE rss [
  <!ENTITY author "Example">
]>
<rss version="2.0"/>`;
  const comment = `<!-- comment -->
<!doctype rss>
<rss version="2.0"/>`;
  const bareEntity = `<rss version="2.0"><!ENTITY author "Example"></rss>`;

  expect(() => parseFeed(internalSubset, base)).toThrow(
    'Unsupported XML declarations'
  );
  expect(() => parseFeed(comment, base)).toThrow(
    'Unsupported XML declarations'
  );
  expect(() => parseFeed(bareEntity, base)).toThrow(
    'Unsupported XML declarations'
  );
});

it('allows declaration literals inside comments, CDATA and processing instructions', () => {
  const xml = `<?xml version="1.0"?>
<!-- <!DOCTYPE html> is documentation here -->
<?xml-stylesheet href="<!DOCTYPE html>" type="text/css"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Literals</title>
    <item>
      <title>Markup</title>
      <description><![CDATA[<!DOCTYPE html> <!ENTITY author "Example"> <![CDATA[ nested ]]>]]></description>
      <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
  const feed = parseFeed(xml, base);
  expect(feed.title).toBe('Literals');
  expect(feed.articles[0]).toMatchObject({
    title: 'Markup',
    description:
      '<!DOCTYPE html> <!ENTITY author "Example"> <![CDATA[ nested ]]>',
    content: '<p>Body</p>',
  });
});

it('parses JSON feeds whose text contains declaration literals', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Literals',
    items: [
      {
        id: '1',
        title: 'Document type',
        content_text: '<!DOCTYPE html><p>Body</p>',
      },
      {
        id: '2',
        title: 'Entity',
        content_text: '<!ENTITY author "Example">',
      },
      {
        id: '3',
        title: 'CDATA',
        content_text: '<![CDATA[<!DOCTYPE html>]]>',
      },
      {
        id: '4',
        title: 'Comment',
        content_text: '<!-- <!DOCTYPE html> -->',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expect(feed.title).toBe('Literals');
  const [doctype, entity, cdata, comment] = feed.articles;
  expect(doctype).toMatchObject({
    content: '&lt;!DOCTYPE html&gt;&lt;p&gt;Body&lt;/p&gt;',
  });
  expect(entity).toMatchObject({
    content: '&lt;!ENTITY author "Example"&gt;',
  });
  expect(cdata).toMatchObject({
    content: '&lt;![CDATA[&lt;!DOCTYPE html&gt;]]&gt;',
  });
  expect(comment).toMatchObject({
    content: '&lt;!-- &lt;!DOCTYPE html&gt; --&gt;',
  });
});

it('parses JSON feeds that start with a byte order mark', () => {
  const json = `\uFEFF${JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'BOM',
    items: [
      { id: '1', title: 'Document type', content_text: '<!DOCTYPE html>' },
    ],
  })}`;
  const feed = parseFeed(json, base);
  expect(feed.title).toBe('BOM');
  expect(feed.articles[0]).toMatchObject({
    content: '&lt;!DOCTYPE html&gt;',
  });
});

it.effect('parses feed content through the FeedParser service', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const feed = yield* parser.parse(rss, base);
    expect(feed.title).toBe('News');
    expect(feed.articles[0]?.url?.href).toBe('https://example.com/a');
  }).pipe(Effect.provide(FeedParserLive))
);

it.effect('reports unparseable content as a ParseSubscriptionError', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const error = yield* Effect.flip(parser.parse('<html></html>', base));
    expect(error).toMatchObject({
      _tag: 'ParseSubscriptionError',
      message: 'Failed to parse the subscription feed',
    });
  }).pipe(Effect.provide(FeedParserLive))
);
