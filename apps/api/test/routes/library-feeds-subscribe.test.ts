import { expect, it } from '@effect/vitest';
import { FeedTitle } from '@reader/business';
import { Effect, Option } from 'effect';
import {
  fetchFeedItems,
  listFeeds,
  readFailure,
  readFeed,
  readFeeds,
  readItemPage,
  seedFeed,
  sessionFor,
  subscribe,
} from './library-feeds-support';
import { makeHarness } from './library-support';

const quietParsedFeed = {
  title: FeedTitle.make('Source title'),
  description: Option.none(),
  entries: [],
};

it.effect('subscribes with the request title and queues one refresh', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      let fetches = 0;
      let parses = 0;
      harness.stubs.feed = (url) => {
        fetches += 1;

        return { content: '<rss/>', url };
      };
      harness.stubs.parsedFeed = () => {
        parses += 1;

        return quietParsedFeed;
      };

      const response = yield* Effect.promise(() =>
        subscribe(harness, alice, {
          url: ' https://example.com/feed.xml?utm_source=news#top ',
          title: ' My feed ',
        })
      );
      const { raw, item } = yield* Effect.promise(() => readFeed(response));
      const feeds = yield* Effect.promise(() => listFeeds(harness, alice));

      expect(response.status).toBe(201);
      expect(raw).toEqual({
        id: item.id,
        ownerId: alice.owner,
        url: 'https://example.com/feed.xml',
        title: 'My feed',
      });
      expect(harness.enqueued).toEqual([
        { owner: alice.owner, feedId: item.id },
      ]);
      expect(fetches).toBe(0);
      expect(parses).toBe(0);
      expect(
        (yield* Effect.promise(() => readFeeds(feeds))).page.items.map(
          (feed) => feed.id
        )
      ).toEqual([item.id]);
    })
  )
);

it.effect('leaves a new subscription without items', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        subscribe(harness, alice, { url: 'https://example.com/feed.xml' })
      );
      const items = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { limit: 30 })
      );

      expect(response.status).toBe(201);
      expect(yield* Effect.promise(() => readItemPage(items))).toEqual({
        raw: { items: [], cursor: null },
        page: { items: [], cursor: null },
      });
    })
  )
);

it.effect('uses the address host when the title is blank or absent', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const blank = yield* Effect.promise(() =>
        subscribe(harness, alice, {
          url: 'https://example.com/one.xml',
          title: '   ',
        })
      );
      const absent = yield* Effect.promise(() =>
        subscribe(harness, alice, {
          url: 'https://news.site:8080/two.xml',
        })
      );

      expect(blank.status).toBe(201);
      expect(absent.status).toBe(201);
      expect((yield* Effect.promise(() => readFeed(blank))).item.title).toBe(
        'example.com'
      );
      expect((yield* Effect.promise(() => readFeed(absent))).item.title).toBe(
        'news.site:8080'
      );
    })
  )
);

it.effect('reports a duplicate subscription with the normalized url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const first = yield* Effect.promise(() =>
        subscribe(harness, alice, { url: 'https://example.com/feed.xml' })
      );
      const duplicate = yield* Effect.promise(() =>
        subscribe(harness, alice, {
          url: 'https://example.com/feed.xml?utm_source=x#top',
        })
      );
      const feeds = yield* Effect.promise(() => listFeeds(harness, alice));

      expect(first.status).toBe(201);
      expect(duplicate.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(duplicate))).toEqual({
        _tag: 'FeedAlreadyExists',
        message: '该订阅已存在',
        url: 'https://example.com/feed.xml',
      });
      expect(harness.enqueued).toHaveLength(1);
      expect(
        (yield* Effect.promise(() => readFeeds(feeds))).page.items
      ).toHaveLength(1);
    })
  )
);

it.effect('rejects an invalid subscription address', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() =>
        subscribe(harness, alice, { url: 'ftp://example.com/feed.xml' })
      );

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedUrlInvalid',
        message: '请输入有效的订阅地址',
      });
      expect(harness.enqueued).toEqual([]);
    })
  )
);

it.effect('subscribing does not touch another owner feeds', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const mine = yield* seedFeed(harness, alice.owner, { title: 'Mine' });
      const response = yield* Effect.promise(() =>
        subscribe(harness, bob, { url: 'https://example.com/feed.xml' })
      );
      const theirFeeds = yield* Effect.promise(() => listFeeds(harness, alice));

      expect(response.status).toBe(201);
      expect(
        (yield* Effect.promise(() => readFeeds(theirFeeds))).page.items.map(
          (feed) => feed.id
        )
      ).toEqual([mine.id]);
    })
  )
);
