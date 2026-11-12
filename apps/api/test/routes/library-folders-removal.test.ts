import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  groupFeed,
  readFeedItems,
  readFeeds,
  readJson,
  readSavedPages,
  seedFeed,
  seedFolder,
  seedItem,
  seedPage,
  sessionFor,
} from './library-fixtures';
import { type Harness, makeHarness } from './library-support';

const FOLDERS = '/api/library/folders';
const FEEDS = '/api/library/feeds';
const FEED_ITEMS = '/api/library/feeds/items';
const SAVED_PAGES = '/api/library/saved-pages';

const listFeedIds = (harness: Harness, cookie: string) =>
  Effect.gen(function* () {
    const response = yield* call(harness, { path: FEEDS, cookie });
    const feeds = yield* Effect.promise(() => readFeeds(response));

    return feeds.map((feed) => feed.id);
  });

const listItemIds = (harness: Harness, cookie: string) =>
  Effect.gen(function* () {
    const response = yield* call(harness, {
      path: FEED_ITEMS,
      cookie,
      query: { unreadOnly: false, limit: 30 },
    });
    const page = yield* Effect.promise(() => readFeedItems(response));

    return page.items.map((item) => item.id);
  });

const listSavedPageIds = (harness: Harness, cookie: string) =>
  Effect.gen(function* () {
    const response = yield* call(harness, {
      path: SAVED_PAGES,
      cookie,
      query: { limit: 30 },
    });
    const page = yield* Effect.promise(() => readSavedPages(response));

    return page.items.map((saved) => saved.id);
  });

it.effect('removes a folder with its feeds and items', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const grouped = yield* seedFeed(harness, session.owner);
      const topLevel = yield* seedFeed(harness, session.owner);
      yield* groupFeed(harness, session, grouped.id, folder.id);
      yield* seedItem(harness, session.owner, grouped.id);
      const keptItem = yield* seedItem(harness, session.owner, topLevel.id);
      const page = yield* seedPage(harness, session.owner);

      const removed = yield* call(harness, {
        method: 'DELETE',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: folder.id },
      });

      expect(removed.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(removed))).toEqual({
        ok: true,
      });
      expect(yield* listFeedIds(harness, session.cookie)).toEqual([
        topLevel.id,
      ]);
      expect(yield* listItemIds(harness, session.cookie)).toEqual([
        keptItem.id,
      ]);
      expect(yield* listSavedPageIds(harness, session.cookie)).toEqual([
        page.id,
      ]);
    })
  )
);

it.effect('removes nothing for an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      yield* seedItem(harness, session.owner, feed.id);

      const response = yield* call(harness, {
        method: 'DELETE',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: '01234567-89ab-7cde-8123-456789abcdef' },
      });

      expect(response.status).toBe(200);
      expect(yield* listFeedIds(harness, session.cookie)).toEqual([feed.id]);
    })
  )
);

it.effect('rejects folder requests without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      const response = yield* call(harness, { path: FOLDERS });

      expect(response.status).toBe(401);
    })
  )
);
