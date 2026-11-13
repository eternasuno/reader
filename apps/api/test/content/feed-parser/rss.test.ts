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
  rss,
} from '../../support/feed-parser';

it('FD-PARSE-2 FD-PARSE-1 drops RSS items without a valid URL and resolves relative links', () => {
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
  expect(parseFeed(`\uFEFF${rss}`, base).title).toBe('News');
});

it('FD-PARSE-6 never uses the RSS description as content', () => {
  const described = `<rss version="2.0">
    <channel>
      <title>Descriptions</title>
      <item>
        <title>Described</title>
        <link>https://example.com/described</link>
        <description>Only a description</description>
      </item>
    </channel>
  </rss>`;
  const [entry] = parseFeed(described, base).entries;
  expectDescription(entry, 'Only a description');
  expectOptional(entry, (item) => item.content, Option.none());
});

it('FD-PARSE-2 resolves relative links against the redirected feed url and preserves credentials', () => {
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

it('FD-PARSE-7 uses only pubDate for RSS dates and keeps a missing date as none', () => {
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

it('FD-PARSE-7 keeps an unparseable date as none', () => {
  const invalid = `<rss version="2.0">
    <channel>
      <title>Invalid</title>
      <item>
        <title>Broken date</title>
        <link>https://example.com/broken-date</link>
        <pubDate>not a date</pubDate>
      </item>
    </channel>
  </rss>`;
  const [entry] = parseFeed(invalid, base).entries;
  expect(entry?.title).toBe('Broken date');
  expectNoPublishedAt(entry);
});

it('FD-PARSE-9 FD-PARSE-8 falls back to Untitled for missing entry titles and the host for a missing feed title', () => {
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
