import { expect, it } from '@effect/vitest';
import { FeedParser, type ParsedFeedEntry } from '@reader/business';
import { DateTime, Effect, Option } from 'effect';
import { FeedParserLive, parseFeed } from '../../src/adapter/feed-parser';

const base = new URL('https://example.com/feed.xml');

const field = <A>(
  entry: ParsedFeedEntry | undefined,
  select: (entry: ParsedFeedEntry) => Option.Option<A>
) => Option.flatMap(Option.fromUndefinedOr(entry), select);

const isoOf = (entry: ParsedFeedEntry | undefined) =>
  Option.match(
    field(entry, (item) => item.publishedAt),
    {
      onNone: () => undefined,
      onSome: DateTime.formatIso,
    }
  );

const expectOptional = <A>(
  entry: ParsedFeedEntry | undefined,
  select: (entry: ParsedFeedEntry) => Option.Option<A>,
  expected: Option.Option<A>
) => expect(field(entry, select)).toEqual(expected);

const expectDescription = (entry: ParsedFeedEntry | undefined, value: string) =>
  expectOptional(entry, (item) => item.description, Option.some(value));

const expectContent = (entry: ParsedFeedEntry | undefined, value: string) =>
  expectOptional(entry, (item) => item.content, Option.some(value));

const expectNoPublishedAt = (entry: ParsedFeedEntry | undefined) =>
  expectOptional(entry, (item) => item.publishedAt, Option.none());

const expectLink = (entry: ParsedFeedEntry | undefined, value: string) =>
  expect(entry?.url.href).toBe(value);

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
  </channel>
</rss>`;

it('drops RSS items without a valid URL and resolves relative links', () => {
  const feed = parseFeed(rss, base);
  expect(feed.title).toBe('News');
  expect(feed.description).toEqual(Option.some('Daily'));
  expect(feed.entries).toHaveLength(2);
  const [first, second] = feed.entries;
  expect(first?.title).toBe('First');
  expectDescription(first, 'Summary');
  expectContent(first, '<p>Body</p>');
  expectLink(first, 'https://example.com/a');
  expect(isoOf(first)).toBe('2026-01-01T00:00:00.000Z');
  expectLink(second, 'https://example.com/b');
  expectNoPublishedAt(second);
});

it('resolves relative links against the redirected feed url and preserves credentials', () => {
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
  expectLink(feed.entries[0], 'https://mirror.example.com/story');
  expectLink(feed.entries[1], 'https://alice:secret@example.com/private');
});

it('uses only pubDate for RSS dates and keeps a missing date as none', () => {
  const dated = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <title>News</title>
      <item>
        <title>Dated</title>
        <link>https://example.com/dated</link>
        <dc:date>2026-01-05T00:00:00Z</dc:date>
      </item>
      <item>
        <title>Undated</title>
        <link>https://example.com/undated</link>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(dated, base);
  expectNoPublishedAt(feed.entries[0]);
  expectNoPublishedAt(feed.entries[1]);
});

it('falls back to Untitled for missing entry titles and the host for a missing feed title', () => {
  const untitled = `<rss version="2.0">
    <channel>
      <item>
        <title>   </title>
        <link>https://example.com/no-title</link>
        <description>No title</description>
      </item>
    </channel>
  </rss>`;
  const feed = parseFeed(untitled, base);
  expect(feed.title).toBe('example.com');
  expect(feed.entries[0]).toMatchObject({ title: 'Untitled' });
});

it('limits entry titles but keeps long descriptions and content', () => {
  const longTitle = 'x'.repeat(600);
  const longText = 'y'.repeat(120_000);
  const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel>
      <title>Long</title>
      <item>
        <title>${longTitle}</title>
        <link>https://example.com/long</link>
        <description>${longText}</description>
        <content:encoded><![CDATA[${longText}]]></content:encoded>
      </item>
    </channel>
  </rss>`;
  const [entry] = parseFeed(xml, base).entries;
  const description = Option.getOrThrow(entry?.description ?? Option.none());
  const content = Option.getOrThrow(entry?.content ?? Option.none());
  expect(entry?.title).toHaveLength(500);
  expect(description).toHaveLength(120_000);
  expect(content).toHaveLength(120_000);
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
      <link href="https://example.com/m"/>
      <summary type="html">&lt;b&gt;bold&lt;/b&gt;</summary>
      <content type="text">plain</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(feed.title).toBe('Atom News');
  expect(feed.description).toEqual(Option.some('Updates'));
  const [entry, text, mixed] = feed.entries;
  expect(entry?.title).toBe('Entry');
  expectDescription(entry, 'Plain summary');
  expectContent(entry, '<p>Body</p>');
  expectLink(entry, 'https://example.com/e');
  expect(isoOf(entry)).toBe('2026-01-02T00:00:00.000Z');
  expectContent(text, 'plain body');
  expectLink(text, 'https://example.com/t');
  expectDescription(mixed, '<b>bold</b>');
  expectContent(mixed, 'plain');
});

it('normalizes Atom content and summaries without a media type as plain text', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Untyped</title>
    <entry>
      <title>Default summary</title>
      <link href="https://example.com/summary"/>
      <summary>plain summary</summary>
    </entry>
    <entry>
      <title>Default content</title>
      <link href="https://example.com/content"/>
      <content>plain content</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  const [summary, content] = feed.entries;
  expectDescription(summary, 'plain summary');
  expectOptional(summary, (item) => item.content, Option.none());
  expectContent(content, 'plain content');
});

it('uses only published for Atom dates', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Dates</title>
    <entry>
      <title>Updated</title>
      <link href="https://example.com/updated"/>
      <updated>2026-01-06T00:00:00Z</updated>
    </entry>
    <entry>
      <title>Published</title>
      <link href="https://example.com/published"/>
      <published>2026-01-07T00:00:00Z</published>
      <updated>2026-01-08T00:00:00Z</updated>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expectNoPublishedAt(feed.entries[0]);
  expect(isoOf(feed.entries[1])).toBe('2026-01-07T00:00:00.000Z');
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
  const [preferred, untyped, fallback] = feed.entries;
  expectLink(preferred, 'https://example.com/html');
  expectLink(untyped, 'https://example.com/untyped');
  expectLink(fallback, 'https://example.com/xhtml');
});

it('maps Atom content and summary media types and drops external or unsupported content', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Media</title>
    <entry>
      <title>HTML</title>
      <link href="https://example.com/html"/>
      <summary type="text/html">&lt;i&gt;summary&lt;/i&gt;</summary>
      <content type="text/html">&lt;p&gt;html&lt;/p&gt;</content>
    </entry>
    <entry>
      <title>XHTML</title>
      <link href="https://example.com/xhtml"/>
      <content type="application/xhtml+xml"><div xmlns="http://www.w3.org/1999/xhtml"><p>xhtml</p></div></content>
    </entry>
    <entry>
      <title>Plain</title>
      <link href="https://example.com/plain"/>
      <content type="text/plain">text/plain</content>
    </entry>
    <entry>
      <title>External</title>
      <link href="https://example.com/external"/>
      <content type="text/html" src="https://example.com/external.html">&lt;p&gt;ignored&lt;/p&gt;</content>
    </entry>
    <entry>
      <title>Binary</title>
      <link href="https://example.com/binary"/>
      <content type="image/png">cG5n</content>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(feed.entries).toHaveLength(5);
  const [html, xhtml, plain, external, binary] = feed.entries;
  expectDescription(html, '<i>summary</i>');
  expectContent(html, '<p>html</p>');
  expectContent(xhtml, '<p>xhtml</p>');
  expectContent(plain, 'text/plain');
  expectOptional(external, (item) => item.content, Option.none());
  expectOptional(binary, (item) => item.content, Option.none());
});

it('uses only date_published for JSON Feed dates', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Dates',
    items: [
      {
        id: '1',
        url: 'https://example.com/modified',
        title: 'Modified',
        date_modified: '2026-01-09T00:00:00Z',
      },
      {
        id: '2',
        url: 'https://example.com/published',
        title: 'Published',
        date_published: '2026-01-10T00:00:00Z',
        date_modified: '2026-01-11T00:00:00Z',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expectNoPublishedAt(feed.entries[0]);
  expect(isoOf(feed.entries[1])).toBe('2026-01-10T00:00:00.000Z');
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
  expect(feed.description).toEqual(Option.some('J'));
  expect(feed.entries).toHaveLength(1);
  expect(feed.entries[0]?.title).toBe('J1');
  expectDescription(feed.entries[0], 'sum');
  expectContent(feed.entries[0], 'body');
  expect(isoOf(feed.entries[0])).toBe('2026-01-03T00:00:00.000Z');
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
  expect(feed.description).toEqual(Option.some('RDF daily'));
  expect(feed.entries[0]?.title).toBe('R');
  expectDescription(feed.entries[0], 'rdf summary');
  expect(isoOf(feed.entries[0])).toBe('2026-01-04T00:00:00.000Z');
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
      <link>https://example.com/markup</link>
      <description><![CDATA[<!DOCTYPE html> <!ENTITY author "Example"> <![CDATA[ nested ]]>]]></description>
      <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
  const feed = parseFeed(xml, base);
  expect(feed.title).toBe('Literals');
  expect(feed.entries[0]?.title).toBe('Markup');
  expectDescription(
    feed.entries[0],
    '<!DOCTYPE html> <!ENTITY author "Example"> <![CDATA[ nested ]]>'
  );
  expectContent(feed.entries[0], '<p>Body</p>');
});

it('parses JSON feeds whose text contains declaration literals', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Literals',
    items: [
      {
        id: '1',
        url: 'https://example.com/1',
        title: 'Document type',
        content_text: '<!DOCTYPE html><p>Body</p>',
      },
      {
        id: '2',
        url: 'https://example.com/2',
        title: 'Entity',
        content_text: '<!ENTITY author "Example">',
      },
      {
        id: '3',
        url: 'https://example.com/3',
        title: 'CDATA',
        content_text: '<![CDATA[<!DOCTYPE html>]]>',
      },
      {
        id: '4',
        url: 'https://example.com/4',
        title: 'Comment',
        content_text: '<!-- <!DOCTYPE html> -->',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expect(feed.title).toBe('Literals');
  const [doctype, entity, cdata, comment] = feed.entries;
  expectContent(doctype, '&lt;!DOCTYPE html&gt;&lt;p&gt;Body&lt;/p&gt;');
  expectContent(entity, '&lt;!ENTITY author "Example"&gt;');
  expectContent(cdata, '&lt;![CDATA[&lt;!DOCTYPE html&gt;]]&gt;');
  expectContent(comment, '&lt;!-- &lt;!DOCTYPE html&gt; --&gt;');
  expect(parseFeed(`\uFEFF${json}`, base).title).toBe('Literals');
});

it.effect('parses feed content through the FeedParser service', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const feed = yield* parser.parse(rss, base);
    expect(feed.title).toBe('News');
    expectLink(feed.entries[0], 'https://example.com/a');
  }).pipe(Effect.provide(FeedParserLive))
);

it.effect('reports unparseable content as a FeedParserError', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const error = yield* Effect.flip(parser.parse('<html></html>', base));
    expect(error).toMatchObject({
      _tag: 'FeedParserError',
      message: 'Failed to parse the subscription feed',
    });
  }).pipe(Effect.provide(FeedParserLive))
);

it('normalizes article URLs and metadata before returning parsed entries', () => {
  const feed = parseFeed(
    `<rss version="2.0"><channel><title>News</title><item>
    <title>  </title><link>/story?UTM_Source=tracker&amp;keep=1</link>
    <description>  Summary  </description>
  </item></channel></rss>`,
    base
  );
  const [entry] = feed.entries;
  expect(entry?.title).toBe('Untitled');
  expectLink(entry, 'https://example.com/story?keep=1');
  expectDescription(entry, 'Summary');
});
