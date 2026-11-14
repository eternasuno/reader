import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option } from 'effect';
import { HttpClient } from 'effect/http';
import type { Feed } from '../../../../src/entity/feed/feed';
import { Retention } from '../../../../src/entity/setting/retention';
import { DocumentSanitizer } from '../../../../src/port/document-sanitizer';
import { FeedItemRepositoryError } from '../../../../src/port/feed-item-repository';
import { FeedParser } from '../../../../src/port/feed-parser';
import {
  FeedRepository,
  type IFeedRepository,
} from '../../../../src/port/feed-repository';
import { HtmlParser } from '../../../../src/port/html-parser';
import { SettingRepository } from '../../../../src/port/setting-repository';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import {
  alice,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
} from '../../../support/fixtures';
import { memoryFeedStoreLayer } from '../../../support/memory/feed-store';
import { MemorySettingRepositoryLive } from '../../../support/memory/setting';
import {
  defaultParseHtml,
  defaultSanitize,
  feedResponse,
  findFeed,
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
  storeFeed,
  storeItems,
  urlsOf,
} from '../../../support/usecase/feed';

const base = 'https://example.com';

const feedOf = (): Feed => makeUniqueFeed({ ownerId: alice });

describe('refreshFeed retention', () => {
  it.effect('removes the stored items below the retention', () =>
    Effect.gen(function* () {
      const feed = feedOf();
      const urls = Array.from(
        { length: 31 },
        (_, index) => `${base}/item/${index}`
      );
      const stored = [...urls]
        .reverse()
        .map((url) =>
          makeFeedItem({ ownerId: alice, feedId: feed.id, url: decodeUrl(url) })
        );
      const parsed = parsedFeed({
        entries: urls.map((url) => parsedEntry(url)),
      });

      const items = yield* run(
        Effect.gen(function* () {
          const settings = yield* SettingRepository;

          yield* storeFeed(feed);
          yield* storeItems(alice, stored);
          yield* settings.setRetention(alice, Retention.make(30));
          yield* refreshFeed(alice, feed.id);

          return yield* storedItems(alice, feed.id);
        }),
        { parseFeed: () => Effect.succeed(parsed) }
      );

      expect(items).toHaveLength(30);
      expect(urlsOf(items)).toEqual(urls.slice(0, 30));
    })
  );
});

const thirtyOneUrls = (): ReadonlyArray<string> =>
  Array.from({ length: 31 }, (_, index) => `${base}/item/${index}`);

const storedFor = (
  feed: Feed,
  urls: ReadonlyArray<string>,
  read: (index: number) => boolean
) =>
  [...urls].reverse().map((url, index) =>
    makeFeedItem({
      ownerId: alice,
      feedId: feed.id,
      url: decodeUrl(url),
      read: read(index),
    })
  );

// Index 0 of the stored array is the first created, so it is the bottom row.
const refreshWithRetention = (bottomRead: boolean, retention: number) => {
  const feed = feedOf();
  const urls = thirtyOneUrls();
  const stored = storedFor(feed, urls, (index) =>
    index === 0 ? bottomRead : true
  );
  const parsed = parsedFeed({ entries: urls.map((url) => parsedEntry(url)) });

  return {
    urls,
    effect: run(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* storeFeed(feed);
        yield* storeItems(alice, stored);
        yield* settings.setRetention(alice, Retention.make(retention));
        const before = urlsOf(yield* storedItems(alice, feed.id));
        yield* refreshFeed(alice, feed.id);

        return { before, after: urlsOf(yield* storedItems(alice, feed.id)) };
      }),
      { parseFeed: () => Effect.succeed(parsed) }
    ),
  };
};

describe('refreshFeed retention and read state', () => {
  it.effect(
    'FD-SEL-4 removes unread items beyond the retention like read ones',
    () =>
      Effect.gen(function* () {
        const readBottom = refreshWithRetention(true, 30);
        const unreadBottom = refreshWithRetention(false, 30);

        const read = yield* readBottom.effect;
        const unread = yield* unreadBottom.effect;

        expect(read.after).toEqual(readBottom.urls.slice(0, 30));
        expect(unread.after).toEqual(readBottom.urls.slice(0, 30));
        expect(unread.after).toEqual(read.after);
      })
  );
});

describe('refreshFeed retention setting', () => {
  it.effect(
    'SET-FEED-2 applies a lowered retention at the next refresh, not before',
    () =>
      Effect.gen(function* () {
        const { urls, effect } = refreshWithRetention(true, 20);
        const result = yield* effect;

        expect(result.before).toEqual(urls);
        expect(result.after).toEqual(urls.slice(0, 20));
      })
  );
});

const failingCreateLayer = Layer.mergeAll(
  memoryFeedStoreLayer((items) => ({
    ...items,
    create: () =>
      Effect.fail(new FeedItemRepositoryError({ message: 'create' })),
  })),
  MemorySettingRepositoryLive,
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((_request, url) =>
      Effect.succeed(feedResponse({ url: url.href }))
    )
  ),
  Layer.mock(FeedParser, {
    parse: () =>
      Effect.succeed(
        parsedFeed({
          title: 'Source title',
          entries: [parsedEntry(`${base}/a`)],
        })
      ),
  }),
  Layer.mock(HtmlParser, { parse: defaultParseHtml }),
  Layer.mock(DocumentSanitizer, { sanitize: defaultSanitize })
);

describe('refreshFeed write failures', () => {
  it.effect('keeps the feed title and time when creating items fails', () =>
    Effect.gen(function* () {
      const feed = feedOf();

      const result = yield* Effect.gen(function* () {
        yield* storeFeed(feed);

        return {
          error: yield* refreshFeed(alice, feed.id).pipe(Effect.flip),
          stored: yield* findFeed(alice, feed.id),
        };
      }).pipe(Effect.provide(failingCreateLayer));

      expect(result.error).toStrictEqual(
        new FeedItemRepositoryError({ message: 'create' })
      );
      expect(Option.getOrThrow(result.stored)).toEqual(feed);
    })
  );

  it.effect('creates no items when the feed is gone', () =>
    Effect.gen(function* () {
      const feed = feedOf();
      let repository: IFeedRepository | undefined;

      const result = yield* run(
        Effect.gen(function* () {
          repository = yield* FeedRepository;
          yield* storeFeed(feed);
          yield* refreshFeed(alice, feed.id);

          return {
            items: yield* storedItems(alice, feed.id),
            feed: yield* findFeed(alice, feed.id),
          };
        }),
        {
          parseFeed: () =>
            Effect.gen(function* () {
              if (repository !== undefined) {
                yield* repository.remove(alice, [feed.id]).pipe(Effect.orDie);
              }

              return parsedFeed({
                title: 'Source title',
                entries: [parsedEntry(`${base}/a`)],
              });
            }),
        }
      );

      expect(result.items).toEqual([]);
      expect(Option.isNone(result.feed)).toBe(true);
    })
  );
});
