import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  base,
  expectContent,
  expectDescription,
  expectLink,
  expectNoPublishedAt,
  expectOptional,
  isoOf,
  parseFeed,
} from '../support/feed-parser';
import { rss } from '../support/fixtures';

it.effect(
  'FD-PARSE-2 FD-PARSE-6 FD-PARSE-7 FD-PARSE-8 maps RSS items and drops entries without a usable url',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(rss);

      expect(feed.title).toBe('News');
      expect(feed.description).toEqual(Option.some('Daily'));
      expect(feed.entries.map((entry) => entry.title)).toEqual([
        'First',
        'Relative',
        'Again',
      ]);

      const [first, relative] = feed.entries;
      expectDescription(first, 'Summary');
      expectContent(first, '<p>Body</p>');
      expectLink(first, 'https://example.com/a');
      expect(isoOf(first)).toBe('2026-01-01T00:00:00.000Z');
      expectLink(relative, 'https://example.com/b');
      expectNoPublishedAt(relative);
    })
);

it.effect(
  'FD-PARSE-2 resolves relative links against the given url and keeps credentials',
  () =>
    Effect.gen(function* () {
      const moved = new URL('https://mirror.example.com/feeds/news.xml');
      const feed = yield* parseFeed(
        `<rss version="2.0"><channel><title>Moved</title>
          <item><title>Relative</title><link>../story</link></item>
          <item><title>Credentials</title><link>https://alice:secret@example.com/private</link></item>
        </channel></rss>`,
        moved
      );

      expectLink(feed.entries[0], 'https://mirror.example.com/story');
      expectLink(feed.entries[1], 'https://alice:secret@example.com/private');
    })
);

it.effect('FD-PARSE-6 never uses the RSS description as content', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<rss version="2.0"><channel><title>Descriptions</title>
        <item><title>Described</title><link>https://example.com/described</link>
          <description>Only a description</description></item>
      </channel></rss>`
    );

    const [entry] = feed.entries;
    expectDescription(entry, 'Only a description');
    expectOptional(entry, (item) => item.content, Option.none());
  })
);

it.effect('FD-PARSE-7 uses only pubDate for RSS times', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>News</title>
          <item><title>Dated</title><link>https://example.com/dated</link>
            <dc:date>2026-01-05T00:00:00Z</dc:date></item>
          <item><title>Published</title><link>https://example.com/published</link>
            <pubDate>Thu, 08 Jan 2026 00:00:00 GMT</pubDate></item>
        </channel></rss>`
    );

    expectNoPublishedAt(feed.entries[0]);
    expect(isoOf(feed.entries[1])).toBe('2026-01-08T00:00:00.000Z');
  })
);

it.effect('FD-PARSE-7 keeps an unparseable time as none', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<rss version="2.0"><channel><title>Invalid</title>
        <item><title>Broken date</title><link>https://example.com/broken</link>
          <pubDate>not a date</pubDate></item>
      </channel></rss>`
    );

    expect(feed.entries[0]?.title).toBe('Broken date');
    expectNoPublishedAt(feed.entries[0]);
  })
);

it.effect('FD-PARSE-8 FD-PARSE-9 decodes the feed and entry titles', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<rss version="2.0"><channel>
        <item><title>   </title><link>https://example.com/no-title</link>
          <description>No title</description></item>
      </channel></rss>`,
      base
    );

    expect(feed.title).toBe('example.com');
    expect(feed.description).toEqual(Option.none());
    expect(feed.entries[0]?.title).toBe('Untitled');
  })
);
