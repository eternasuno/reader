import { expect, it } from '@effect/vitest';
import { parseFeed } from '../../src/infrastructure/feed-parser';

it('parses RSS and Atom, resolves relative links and rejects unsafe entries', () => {
  const rss = parseFeed(
    '<rss><channel><title>News</title><item><guid>one</guid><title>Hello</title><link>/article</link></item><item><link>javascript:alert(1)</link></item></channel></rss>',
    'https://example.com/rss'
  );
  expect(rss.title).toBe('News');
  expect(rss.articles).toHaveLength(1);
  expect(rss.articles[0]?.url).toBe('https://example.com/article');
  const atom = parseFeed(
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>two</id><title>Entry</title><link href="https://example.com/entry" /></entry></feed>',
    'https://example.com/atom'
  );
  expect(atom.articles[0]?.identity).toBe('two');
  expect(() =>
    parseFeed(
      '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',
      'https://example.com'
    )
  ).toThrow();
  expect(() => parseFeed('<html/>', 'https://example.com')).toThrow();
});

it('maps RDF namespace identity and dates', () => {
  const feed = parseFeed(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://example.com/rss"><title>RDF</title><link>https://example.com</link></channel><item rdf:about="unique"><title>Article</title><link>https://example.com/a</link><dc:date>2026-10-17T00:00:00Z</dc:date></item></rdf:RDF>',
    'https://example.com/rss'
  );
  expect(feed.articles[0]?.identity).toBe('unique');
  expect(feed.articles[0]?.publishedAt).toBe('2026-10-17T00:00:00.000Z');
});

it('maps JSON Feed and decodes RSS title entities', () => {
  const json = parseFeed(
    JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'JSON',
      items: [
        {
          id: 'json-1',
          url: '/post',
          title: 'Post',
          date_published: '2026-10-17T00:00:00Z',
        },
      ],
    }),
    'https://example.com/feed'
  );
  expect(json.articles[0]?.url).toBe('https://example.com/post');
  const rss = parseFeed(
    '<rss version="2.0"><channel><title>A &amp; B</title><item><link>https://example.com/a</link><title>A &amp; B</title></item></channel></rss>',
    'https://example.com/rss'
  );
  expect(rss.title).toBe('A & B');
  expect(rss.articles[0]?.title).toBe('A & B');
});

const malicious =
  '<p onclick="bad()">Hello <a href="../safe">link</a><img src="/image" onerror="bad()"><a href="javascript:bad()">bad</a><img src="data:text/html,bad"><script>bad()</script></p>';

it('sanitizes preferred RSS and RDF encoded content against the article URL', () => {
  for (const xml of [
    `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><link>https://example.com/posts/one</link><description>fallback</description><content:encoded><![CDATA[${malicious}]]></content:encoded></item></channel></rss>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel rdf:about="https://example.com/feed"><title>Feed</title></channel><item rdf:about="one"><link>https://example.com/posts/one</link><description>fallback</description><content:encoded><![CDATA[${malicious}]]></content:encoded></item></rdf:RDF>`,
  ]) {
    const description = parseFeed(xml, 'https://example.com/feed').articles[0]
      ?.description;
    expect(description).toContain('https://example.com/safe');
    expect(description).toContain('https://example.com/image');
    expect(description).not.toMatch(
      /onclick|onerror|javascript:|data:|<script|fallback/
    );
  }
});

it('handles Atom HTML content and escapes text summaries', () => {
  const entry = (body: string) =>
    parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><entry><id>one</id><link href="https://example.com/posts/one"/>${body}</entry></feed>`,
      'https://example.com/feed'
    ).articles[0]?.description;
  expect(
    entry(
      `<content type="html"><![CDATA[${malicious}]]></content><summary>fallback</summary>`
    )
  ).not.toMatch(/onclick|onerror|javascript:|data:|<script|fallback/);
  expect(
    entry('<summary type="text">&lt;img src=x onerror=bad()&gt;</summary>')
  ).toBe('&lt;img src=x onerror=bad()&gt;');
});

it('prefers JSON HTML, escapes text fallbacks and bounds descriptions', () => {
  const description = (item: object) =>
    parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Feed',
        items: [{ id: 'one', url: 'https://example.com/posts/one', ...item }],
      }),
      'https://example.com/feed'
    ).articles[0]?.description;
  expect(
    description({ content_html: malicious, content_text: 'fallback' })
  ).not.toMatch(/onclick|onerror|javascript:|data:|<script|fallback/);
  expect(
    description({ content_text: '<b>text</b>', summary: 'fallback' })
  ).toBe('&lt;b&gt;text&lt;/b&gt;');
  expect(description({ summary: '<b>summary</b>' })).toBe(
    '&lt;b&gt;summary&lt;/b&gt;'
  );
  expect(
    description({ content_html: 'x'.repeat(200000) })?.length
  ).toBeLessThanOrEqual(100000);
  expect(description({})).toBeUndefined();
});
