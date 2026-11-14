import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  groupFeed,
  readFeedItems,
  readJson,
  readUnreadFeeds,
  seedFeed,
  seedFolder,
  seedItem,
  sessionFor,
} from '../../../support/fixtures';
import { makeHarness } from '../../../support/harness';

const FEEDS = '/api/library/feeds';
const FEED_ITEMS_BY_FOLDER = '/api/library/feeds/items/by-folder';
const MARK_FOLDERS = '/api/library/folders/mark-read';
const FEEDS_UNREAD = '/api/library/feeds/unread';

type FeedJson = {
  readonly id: string;
  readonly folderId?: string;
};

const readFeedRows = (response: Response) =>
  readJson<{ readonly items: ReadonlyArray<FeedJson> }>(response);

it.effect('moves a feed into a folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const feed = yield* seedFeed(harness, session.owner);

      const moved = yield* call(harness, {
        method: 'PATCH',
        path: FEEDS,
        cookie: session.cookie,
        body: { id: feed.id, folderId: folder.id },
      });
      const listed = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });
      const rows = yield* Effect.promise(() => readFeedRows(listed));

      expect(moved.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(moved))).toEqual({
        ok: true,
      });
      expect(rows.items.map((row) => row.id)).toEqual([feed.id]);
      expect(rows.items.map((row) => row.folderId)).toEqual([folder.id]);
    })
  )
);

it.effect('takes a feed out of its folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      const feed = yield* seedFeed(harness, session.owner);
      yield* call(harness, {
        method: 'PATCH',
        path: FEEDS,
        cookie: session.cookie,
        body: { id: feed.id, folderId: folder.id },
      });

      const moved = yield* call(harness, {
        method: 'PATCH',
        path: FEEDS,
        cookie: session.cookie,
        body: { id: feed.id, folderId: null },
      });
      const listed = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });
      const rows = yield* Effect.promise(() => readFeedRows(listed));
      const row = rows.items[0];

      expect(moved.status).toBe(200);
      expect(row?.id).toBe(feed.id);
      expect(row !== undefined && Object.hasOwn(row, 'folderId')).toBe(false);
    })
  )
);

it.effect('subscribes into a folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'POST',
        path: FEEDS,
        cookie: session.cookie,
        body: {
          url: 'https://example.com/feed.xml',
          title: 'My feed',
          folderId: folder.id,
        },
      });
      const body = yield* Effect.promise(() =>
        readJson<{ readonly item: FeedJson & { readonly title: string } }>(
          response
        )
      );

      expect(response.status).toBe(201);
      expect(body.item.title).toBe('My feed');
      expect(body.item.folderId).toBe(folder.id);
      expect(harness.enqueued.map((entry) => entry.feedId)).toEqual([
        body.item.id,
      ]);
    })
  )
);

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
        path: FEED_ITEMS_BY_FOLDER,
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
