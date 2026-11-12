import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FeedItem } from '../../../src/entity/feed/feed-item';
import type { ParsedFeed } from '../../../src/port/feed-parser';
import { refreshFeed } from '../../../src/usecase/feed/refresh-feed';
import {
  alice,
  decodeTitle,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
} from '../../support';
import {
  type Doubles,
  defaultMaxTextLength,
  findFeed,
  parsedEntry,
  parsedFeed,
  rowAt,
  run,
  storedItems,
  storeFeed,
  storeItems,
  urlsOf,
} from './support';

const base = 'https://example.com';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

const feedOf = (): Feed => makeUniqueFeed({ ownerId: alice });

const sourceEntries = (): ParsedFeed =>
  parsedFeed({
    title: 'Source title',
    entries: [
      parsedEntry(`${base}/a`, {
        title: 'A',
        description: Option.some('<p>A description</p>'),
        content: Option.some('<p>A content</p>'),
        publishedAt: Option.some(publishedAt),
      }),
      parsedEntry(`${base}/b`, { title: 'B' }),
      parsedEntry(`${base}/c`, { title: 'C' }),
    ],
  });

const refreshAndRead = (
  feed: Feed,
  parsed: ParsedFeed,
  doubles: Doubles = {}
) =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* refreshFeed(alice, feed.id, defaultMaxTextLength);

      return {
        items: yield* storedItems(alice, feed.id),
        feed: yield* findFeed(alice, feed.id),
      };
    }),
    { ...doubles, parseFeed: () => Effect.succeed(parsed) }
  );

const refreshWithStored = (
  feed: Feed,
  stored: ReadonlyArray<FeedItem>,
  parsed: ParsedFeed
) =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* storeItems(alice, stored);
      yield* refreshFeed(alice, feed.id, defaultMaxTextLength);

      return yield* storedItems(alice, feed.id);
    }),
    { parseFeed: () => Effect.succeed(parsed) }
  );

const isDescending = (ids: ReadonlyArray<string>): boolean =>
  ids.every((id, index) => index === 0 || (ids[index - 1] ?? '') > id);

describe('refreshFeed stored values', () => {
  it.effect('imports the listed entries in source order', () =>
    Effect.gen(function* () {
      const feed = feedOf();
      const { items } = yield* refreshAndRead(feed, sourceEntries());
      const first = rowAt(items, 0);

      expect(urlsOf(items)).toEqual([`${base}/a`, `${base}/b`, `${base}/c`]);
      expect(items.map((item) => item.title)).toEqual(['A', 'B', 'C']);
      expect(isDescending(items.map((item) => item.id))).toBe(true);
      expect(Option.getOrThrow(first.description)).toBe('<p>A description</p>');
      expect(Option.getOrThrow(first.content)).toBe('<p>A content</p>');
      expect(Option.getOrThrow(first.publishedAt)).toBe(publishedAt);
      expect(Option.isNone(rowAt(items, 1).description)).toBe(true);
      expect(items.every((item) => !item.read)).toBe(true);
      expect(items.every((item) => Option.isNone(item.extractedContent))).toBe(
        true
      );
    })
  );
});

describe('refreshFeed feed update', () => {
  it.effect('sets the feed title and the sync time', () =>
    Effect.gen(function* () {
      const feed = feedOf();

      yield* TestClock.setTime(Date.UTC(2026, 0, 1));
      const { feed: stored } = yield* refreshAndRead(
        feed,
        parsedFeed({ title: 'Source title' })
      );
      const updated = Option.getOrThrow(stored);

      expect(updated.title).toBe('Source title');
      expect(DateTime.toEpochMillis(Option.getOrThrow(updated.updatedAt))).toBe(
        Date.UTC(2026, 0, 1)
      );
    })
  );
});

describe('refreshFeed existing items', () => {
  it.effect('never modifies an entry that is already stored', () =>
    Effect.gen(function* () {
      const feed = feedOf();
      const existing = makeFeedItem({
        ownerId: alice,
        feedId: feed.id,
        url: decodeUrl(`${base}/a`),
        title: decodeTitle('Old title'),
        read: true,
      });
      const items = yield* refreshWithStored(feed, [existing], sourceEntries());
      const kept = rowAt(items, 2);

      expect(urlsOf(items)).toEqual([`${base}/b`, `${base}/c`, `${base}/a`]);
      expect(kept.id).toBe(existing.id);
      expect(kept.title).toBe('Old title');
      expect(kept.read).toBe(true);
    })
  );

  it.effect('creates nothing when the source lists nothing', () =>
    Effect.gen(function* () {
      const items = yield* refreshWithStored(feedOf(), [], parsedFeed());

      expect(items).toEqual([]);
    })
  );
});
