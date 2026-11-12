import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  groupFeed,
  readFailure,
  readFeedItems,
  readJson,
  readUnreadFeeds,
  seedFeed,
  seedFolder,
  seedItem,
  sessionFor,
} from './library-fixtures';
import { makeHarness } from './library-support';

const FEED_ITEMS = '/api/library/feeds/items';
const MARK_FOLDERS = '/api/library/folders/mark-read';
const FEEDS_UNREAD = '/api/library/feeds/unread';

it.effect('lists only the items of the feeds in a folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const grouped = yield* seedFeed(harness, session.owner);
      const other = yield* seedFeed(harness, session.owner);
      yield* groupFeed(harness, session, grouped.id, folder.id);
      const groupedItem = yield* seedItem(harness, session.owner, grouped.id);
      yield* seedItem(harness, session.owner, other.id);

      const response = yield* call(harness, {
        path: FEED_ITEMS,
        cookie: session.cookie,
        query: { folderId: folder.id, unreadOnly: false, limit: 30 },
      });
      const page = yield* Effect.promise(() => readFeedItems(response));

      expect(response.status).toBe(200);
      expect(page.items.map((item) => item.id)).toEqual([groupedItem.id]);
      expect(page.cursor).toBeNull();
    })
  )
);

it.effect('rejects listing by a feed and a folder at once', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const feed = yield* seedFeed(harness, session.owner);

      const response = yield* call(harness, {
        path: FEED_ITEMS,
        cookie: session.cookie,
        query: {
          feedId: feed.id,
          folderId: folder.id,
          unreadOnly: false,
          limit: 30,
        },
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidScope',
        message: '只能按一个订阅源或一个目录列出文章',
      });
    })
  )
);

it.effect('marks the items of a folder read', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const grouped = yield* seedFeed(harness, session.owner);
      const other = yield* seedFeed(harness, session.owner);
      yield* groupFeed(harness, session, grouped.id, folder.id);
      yield* seedItem(harness, session.owner, grouped.id);
      yield* seedItem(harness, session.owner, grouped.id);
      yield* seedItem(harness, session.owner, other.id);

      const marked = yield* call(harness, {
        method: 'POST',
        path: MARK_FOLDERS,
        cookie: session.cookie,
        body: { folderIds: [folder.id] },
      });
      const unread = yield* call(harness, {
        path: FEEDS_UNREAD,
        cookie: session.cookie,
      });

      expect(marked.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(marked))).toEqual({
        ok: true,
      });
      expect(yield* Effect.promise(() => readUnreadFeeds(unread))).toEqual({
        feeds: [{ feedId: other.id, count: 1 }],
      });
    })
  )
);

it.effect('marks nothing read for an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      yield* seedItem(harness, session.owner, feed.id);

      const response = yield* call(harness, {
        method: 'POST',
        path: MARK_FOLDERS,
        cookie: session.cookie,
        body: { folderIds: ['01234567-89ab-7cde-8123-456789abcdef'] },
      });
      const unread = yield* call(harness, {
        path: FEEDS_UNREAD,
        cookie: session.cookie,
      });

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readUnreadFeeds(unread))).toEqual({
        feeds: [{ feedId: feed.id, count: 1 }],
      });
    })
  )
);
