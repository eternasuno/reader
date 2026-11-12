import { expect, it } from '@effect/vitest';
import {
  FeedItemRepositoryError,
  FeedRepositoryError,
  SettingRepositoryError,
} from '@reader/business';
import { Effect } from 'effect';
import {
  fetchFeedItem,
  fetchFeedItems,
  fetchUnreadFeeds,
  listFeeds,
  markAllFeedItemsRead,
  markFeedItem,
  markFeedItemsRead,
  PATHS,
  readFailure,
  seedFeed,
  seedItem,
  sessionFor,
  subscribe,
  unsubscribe,
} from './library-feeds-support';
import type { CallOptions } from './library-support';
import { makeHarness } from './library-support';

const untrustedOrigin = 'https://untrusted.example';

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const libraryCalls: ReadonlyArray<CallOptions> = [
  { path: PATHS.feeds },
  {
    method: 'POST',
    path: PATHS.preview,
    body: { url: 'https://example.com/feed.xml' },
  },
  {
    method: 'POST',
    path: PATHS.feeds,
    body: { url: 'https://example.com/feed.xml' },
  },
  { method: 'DELETE', path: PATHS.feeds, body: { id: unknownId } },
  { path: PATHS.unread },
  { path: PATHS.items, query: { limit: 30 } },
  { path: PATHS.item, query: { id: unknownId } },
  { method: 'POST', path: PATHS.extract, body: { id: unknownId } },
  { method: 'POST', path: PATHS.markFeeds, body: { feedIds: [unknownId] } },
  { method: 'POST', path: PATHS.markAll, body: {} },
  { method: 'PATCH', path: PATHS.items, body: { id: unknownId, read: true } },
  { method: 'POST', path: PATHS.markItems, body: { ids: [unknownId] } },
];

const mutations: ReadonlyArray<CallOptions> = [
  {
    method: 'POST',
    path: PATHS.preview,
    body: { url: 'https://example.com/feed.xml' },
  },
  {
    method: 'POST',
    path: PATHS.feeds,
    body: { url: 'https://example.com/feed.xml' },
  },
  {
    method: 'DELETE',
    path: PATHS.feeds,
    body: { id: unknownId },
  },
  {
    method: 'POST',
    path: PATHS.markItems,
    body: { ids: [unknownId] },
  },
];

const failFeedRepository = () =>
  Effect.fail(new FeedRepositoryError({ message: 'down' }));

const failFeedItemRepository = () =>
  Effect.fail(new FeedItemRepositoryError({ message: 'down' }));

it.effect('rejects every library feed endpoint without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      for (const request of libraryCalls) {
        const response = yield* Effect.promise(() => harness.call(request));
        expect(response.status).toBe(401);
      }
    })
  )
);

it.effect('rejects cross-site feed mutations', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');

      for (const request of mutations) {
        const response = yield* Effect.promise(() =>
          harness.call({
            ...request,
            cookie: alice.cookie,
            origin: untrustedOrigin,
          })
        );
        expect(response.status).toBe(403);
      }
    })
  )
);

it.effect('maps feed repository failures to 500', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      yield* seedFeed(harness, alice.owner);
      Object.assign(harness.repositories.feed, {
        list: failFeedRepository,
        create: failFeedRepository,
        remove: failFeedRepository,
      });

      const responses = [
        yield* Effect.promise(() => listFeeds(harness, alice)),
        yield* Effect.promise(() =>
          subscribe(harness, alice, { url: 'https://example.com/new.xml' })
        ),
        yield* Effect.promise(() => unsubscribe(harness, alice, unknownId)),
      ];

      for (const response of responses) {
        expect(response.status).toBe(500);
        expect(yield* Effect.promise(() => readFailure(response))).toEqual({
          _tag: 'FeedRepositoryError',
          message: '暂时无法访问订阅，请稍后重试',
        });
      }
    })
  )
);

it.effect('maps feed item repository failures to 500', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      yield* seedItem(harness, alice.owner, feed.id);
      Object.assign(harness.repositories.feedItem, {
        list: failFeedItemRepository,
        find: failFeedItemRepository,
        update: failFeedItemRepository,
        updateAll: failFeedItemRepository,
        unreadCounts: failFeedItemRepository,
      });

      const responses = [
        yield* Effect.promise(() =>
          fetchFeedItems(harness, alice, { limit: 30 })
        ),
        yield* Effect.promise(() => fetchFeedItem(harness, alice, unknownId)),
        yield* Effect.promise(() => fetchUnreadFeeds(harness, alice)),
        yield* Effect.promise(() =>
          markFeedItem(harness, alice, { id: unknownId, read: true })
        ),
        yield* Effect.promise(() =>
          markFeedItemsRead(harness, alice, [unknownId])
        ),
        yield* Effect.promise(() => markAllFeedItemsRead(harness, alice)),
      ];

      for (const response of responses) {
        expect(response.status).toBe(500);
        expect(yield* Effect.promise(() => readFailure(response))).toEqual({
          _tag: 'FeedItemRepositoryError',
          message: '暂时无法访问订阅文章，请稍后重试',
        });
      }
    })
  )
);

it.effect('maps a setting repository failure during extraction to 500', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);
      Object.assign(harness.repositories.setting, {
        get: () => Effect.fail(new SettingRepositoryError({ message: 'down' })),
      });

      const response = yield* Effect.promise(() =>
        harness.call({
          method: 'POST',
          path: PATHS.extract,
          cookie: alice.cookie,
          body: { id: item.id },
        })
      );

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'SettingRepositoryError',
        message: '暂时无法访问设置，请稍后重试',
      });
    })
  )
);
