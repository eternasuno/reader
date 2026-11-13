import { expect, it } from '@effect/vitest';
import { ArticleTitle } from '@reader/business';
import { Effect, Option } from 'effect';
import {
  call,
  readExtractedFeedItem,
  readFailure,
  readFeedItem,
  readFeedItems,
  readJson,
  requiredCursor,
  seedFeed,
  seedItem,
  sessionFor,
} from '../../support/fixtures';
import { makeHarness } from '../../support/harness';

const FEED_ITEMS_BY_FEED = '/api/library/feeds/items/by-feed';
const FEED_ITEMS = '/api/library/feeds/items';
const FEED_ITEM = '/api/library/feeds/items/item';
const FEED_EXTRACT = '/api/library/feeds/items/extract';
const MARK_ITEMS = '/api/library/feeds/items/mark-read';
const UNKNOWN_ID = '01234567-89ab-7cde-8123-456789abcdef';

it.effect('lists unread feed items of one feed page by page', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const first = yield* seedItem(harness, session.owner, feed.id);
      yield* seedItem(harness, session.owner, feed.id, { read: true });
      const third = yield* seedItem(harness, session.owner, feed.id);
      const otherFeed = yield* seedFeed(harness, session.owner);
      const otherItem = yield* seedItem(harness, session.owner, otherFeed.id);

      const page = yield* call(harness, {
        path: FEED_ITEMS_BY_FEED,
        cookie: session.cookie,
        query: { feedId: feed.id, unreadOnly: true, limit: 1 },
      });
      const firstPage = yield* Effect.promise(() => readFeedItems(page));

      const firstPageIds = firstPage.items.map((item) => item.id);

      expect(page.status).toBe(200);
      expect(firstPageIds).toEqual([third.id]);
      expect(firstPageIds).not.toContain(otherItem.id);
      expect(firstPage.cursor).not.toBeNull();

      const next = yield* call(harness, {
        path: FEED_ITEMS_BY_FEED,
        cookie: session.cookie,
        query: {
          feedId: feed.id,
          unreadOnly: true,
          limit: 1,
          cursor: requiredCursor(firstPage),
        },
      });
      const nextPage = yield* Effect.promise(() => readFeedItems(next));

      const nextPageIds = nextPage.items.map((item) => item.id);

      expect(nextPageIds).toEqual([first.id]);
      expect(nextPageIds).not.toContain(otherItem.id);
      expect(nextPage.cursor).toBeNull();
    })
  )
);

it.effect('returns the own feed item by id', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const seeded = yield* seedItem(harness, session.owner, feed.id, {
        title: 'Mine',
      });

      const response = yield* call(harness, {
        path: FEED_ITEM,
        cookie: session.cookie,
        query: { id: seeded.id },
      });
      const item = yield* Effect.promise(() => readFeedItem(response));

      expect(response.status).toBe(200);
      expect(item).toEqual(
        expect.objectContaining({
          id: seeded.id,
          feedId: feed.id,
          url: seeded.url,
          title: 'Mine',
          read: false,
        })
      );
    })
  )
);

it.effect('extracts an article for a feed item', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const seeded = yield* seedItem(harness, session.owner, feed.id);

      const response = yield* call(harness, {
        method: 'POST',
        path: FEED_EXTRACT,
        cookie: session.cookie,
        body: { id: seeded.id },
      });
      const item = yield* Effect.promise(() => readExtractedFeedItem(response));

      expect(response.status).toBe(200);
      expect(item.id).toBe(seeded.id);
      expect(Option.getOrThrow(item.extractedContent)).toContain(
        'example article body'
      );
    })
  )
);

it.effect('marks one feed item read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const seeded = yield* seedItem(harness, session.owner, feed.id);

      const marked = yield* call(harness, {
        method: 'PATCH',
        path: FEED_ITEMS,
        cookie: session.cookie,
        body: { id: seeded.id, read: true },
      });
      const found = yield* call(harness, {
        path: FEED_ITEM,
        cookie: session.cookie,
        query: { id: seeded.id },
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect((yield* Effect.promise(() => readFeedItem(found)))?.read).toBe(
        true
      );
    })
  )
);

it.effect('marks a batch of feed items read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const first = yield* seedItem(harness, session.owner, feed.id);
      const second = yield* seedItem(harness, session.owner, feed.id);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_ITEMS,
        cookie: session.cookie,
        body: { ids: [first.id, second.id] },
      });
      const unread = yield* call(harness, {
        path: FEED_ITEMS,
        cookie: session.cookie,
        query: { unreadOnly: true, limit: 10 },
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(
        (yield* Effect.promise(() => readFeedItems(unread))).items
      ).toEqual([]);
    })
  )
);

it.effect('reports an unknown feed item', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FEED_EXTRACT,
        cookie: session.cookie,
        body: { id: UNKNOWN_ID },
      });

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FeedItemNotFound',
        id: UNKNOWN_ID,
      });
    })
  )
);

it.effect('reports an article without extracted content', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        articleExtractor: {
          extract: () =>
            Effect.succeed({
              title: ArticleTitle.make('Empty article'),
              description: Option.none(),
              content: Option.none(),
              publishedAt: Option.none(),
            }),
        },
      });
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const seeded = yield* seedItem(harness, session.owner, feed.id);

      const response = yield* call(harness, {
        method: 'POST',
        path: FEED_EXTRACT,
        cookie: session.cookie,
        body: { id: seeded.id },
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'ArticleEmptyContent',
      });
    })
  )
);
