import { expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { parseFeed } from '../../../src/content/feed-parser';
import {
  base,
  expectContent,
  expectDescription,
  expectLink,
  expectNoPublishedAt,
  expectOptional,
  isoOf,
} from '../../support/feed-parser';

it('FD-PARSE-4 FD-PARSE-8 maps Atom entries and normalizes plain summaries and content', () => {
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

it('FD-PARSE-4 normalizes Atom content and summaries without a media type as plain text', () => {
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

it('FD-PARSE-7 uses only published for Atom dates', () => {
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

it('FD-PARSE-3 prefers Atom alternate links with HTML media types and then without a type', () => {
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

it('FD-PARSE-3 drops an Atom entry that has no alternate link', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Self only</title>
    <entry>
      <title>Self</title>
      <id>https://example.com/self-entry</id>
      <link rel="self" href="https://example.com/self"/>
    </entry>
    <entry>
      <title>Alternate</title>
      <link rel="alternate" href="https://example.com/alternate"/>
    </entry>
  </feed>`;
  const feed = parseFeed(atom, base);
  expect(feed.entries).toHaveLength(1);
  expect(feed.entries[0]?.title).toBe('Alternate');
});

it('FD-PARSE-4 FD-PARSE-6 maps Atom content and summary media types and drops external or unsupported content', () => {
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
