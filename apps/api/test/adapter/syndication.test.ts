import { expect, it } from '@effect/vitest';
import { DateTime, Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Syndication } from '../../../../packages/business/src/port/syndication.ts';
import {
  parseSubscriptionFeed,
  SyndicationLive,
} from '../../src/adapter/syndication';

const base = 'https://example.com/feed.xml';

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
  const feed = parseSubscriptionFeed(rss, base);
  expect(feed.title).toBe('News');
  expect(feed.description).toBe('Daily');
  expect(feed.articles).toHaveLength(4);
  const [first, second, third, linkless] = feed.articles;
  expect(first).toMatchObject({
    title: 'First',
    description: 'Summary',
    content: '<p>Body</p>',
    descriptionText: false,
    contentText: false,
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
  const feed = parseSubscriptionFeed(dated, base);
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
  const feed = parseSubscriptionFeed(untitled, base);
  expect(feed.title).toBe('Untitled');
  expect(feed.articles[0]).toMatchObject({ title: 'Untitled' });
});

it('maps Atom entries with distinct summary and content text flags', () => {
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
  const feed = parseSubscriptionFeed(atom, base);
  expect(feed.title).toBe('Atom News');
  expect(feed.description).toBe('Updates');
  const [entry, text, mixed] = feed.articles;
  expect(entry).toMatchObject({
    title: 'Entry',
    description: 'Plain summary',
    content: '<p>Body</p>',
    descriptionText: true,
    contentText: false,
  });
  expect(entry?.url?.href).toBe('https://example.com/e');
  expect(iso(entry?.publishedAt)).toBe('2026-01-02T00:00:00.000Z');
  expect(text).toMatchObject({
    content: 'plain body',
    descriptionText: true,
    contentText: true,
  });
  expect(text?.url?.href).toBe('https://example.com/t');
  expect(mixed).toMatchObject({
    description: '<b>bold</b>',
    content: 'plain',
    descriptionText: false,
    contentText: true,
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
  const feed = parseSubscriptionFeed(atom, base);
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
  const feed = parseSubscriptionFeed(atom, base);
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
  const feed = parseSubscriptionFeed(atom, base);
  expect(feed.articles).toHaveLength(5);
  const [html, xhtml, plain, external, binary] = feed.articles;
  expect(html).toMatchObject({
    description: '<i>summary</i>',
    descriptionText: false,
    content: '<p>html</p>',
    contentText: false,
  });
  expect(xhtml).toMatchObject({ content: '<p>xhtml</p>', contentText: false });
  expect(plain).toMatchObject({ content: 'text/plain', contentText: true });
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
  const feed = parseSubscriptionFeed(json, base);
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
  const feed = parseSubscriptionFeed(json, base);
  expect(feed.title).toBe('JSON News');
  expect(feed.description).toBe('J');
  expect(feed.articles[0]).toMatchObject({
    title: 'J1',
    description: 'sum',
    content: 'body',
    descriptionText: true,
    contentText: true,
  });
  expect(iso(feed.articles[0]?.publishedAt)).toBe('2026-01-03T00:00:00.000Z');
  expect(feed.articles[1]).toMatchObject({
    title: 'J2',
    content: '<p>rich</p>',
    descriptionText: true,
    contentText: false,
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
  const feed = parseSubscriptionFeed(rdf, base);
  expect(feed.title).toBe('RDF News');
  expect(feed.description).toBe('RDF daily');
  expect(feed.articles[0]).toMatchObject({
    title: 'R',
    description: 'rdf summary',
    descriptionText: false,
    contentText: false,
  });
  expect(iso(feed.articles[0]?.publishedAt)).toBe('2026-01-04T00:00:00.000Z');
});

it('rejects declarations and unparseable documents', () => {
  expect(() => parseSubscriptionFeed('<!DOCTYPE rss><rss/>', base)).toThrow(
    'Unsupported XML declarations'
  );
  expect(() => parseSubscriptionFeed('<html></html>', base)).toThrow();
});

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const sequence =
  (...responses: Response[]) =>
  () => {
    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected request');
    }

    return Promise.resolve(response);
  };

it.effect('fetches and parses a subscription feed', () =>
  Effect.gen(function* () {
    const syndication = yield* Syndication;
    const feed = yield* syndication.fetch(new URL('http://8.8.8.8/rss'));
    expect(feed.title).toBe('News');
    expect(feed.articles[0]?.url?.href).toBe('https://example.com/a');
  }).pipe(
    provideFetch(
      sequence(new Response(rss, { status: 200 })) as typeof globalThis.fetch
    ),
    Effect.provide(SyndicationLive)
  )
);

it.effect('converts fetch and parse failures to typed errors', () =>
  Effect.gen(function* () {
    const syndication = yield* Syndication;
    const fetchError = yield* Effect.flip(
      syndication.fetch(new URL('http://8.8.8.8/rss'))
    );
    expect(fetchError).toMatchObject({
      _tag: 'FetchSubscriptionError',
      message: 'Failed to fetch the subscription feed',
    });
    const parseError = yield* Effect.flip(
      syndication.fetch(new URL('http://8.8.8.8/rss'))
    );
    expect(parseError).toMatchObject({
      _tag: 'ParseSubscriptionError',
      message: 'Failed to parse the subscription feed',
    });
  }).pipe(
    provideFetch(
      sequence(
        new Response('no', { status: 503 }),
        new Response('<html></html>', { status: 200 })
      ) as typeof globalThis.fetch
    ),
    Effect.provide(SyndicationLive)
  )
);
