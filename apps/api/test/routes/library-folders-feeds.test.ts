import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  readFailure,
  readFeeds,
  readJson,
  seedFeed,
  seedFolder,
  sessionFor,
} from './library-fixtures';
import { makeHarness } from './library-support';

const FEEDS = '/api/library/feeds';
const UNKNOWN_ID = '01234567-89ab-7cde-8123-456789abcdef';

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

it.effect('rejects moving a feed into an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FEEDS,
        cookie: session.cookie,
        body: { id: feed.id, folderId: UNKNOWN_ID },
      });
      const listed = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });
      const rows = yield* Effect.promise(() => readFeedRows(listed));

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderNotFound',
        message: '目录不存在，可能已被删除',
        id: UNKNOWN_ID,
      });
      expect(rows.items[0] !== undefined && 'folderId' in rows.items[0]).toBe(
        false
      );
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

it.effect('rejects subscribing into an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FEEDS,
        cookie: session.cookie,
        body: { url: 'https://example.com/feed.xml', folderId: UNKNOWN_ID },
      });
      const listed = yield* call(harness, {
        path: FEEDS,
        cookie: session.cookie,
      });

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderNotFound',
        message: '目录不存在，可能已被删除',
        id: UNKNOWN_ID,
      });
      expect(yield* Effect.promise(() => readFeeds(listed))).toEqual([]);
      expect(harness.enqueued).toEqual([]);
    })
  )
);

it.effect('rejects moving a feed into a folder of another owner', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const folder = yield* seedFolder(harness, alice, 'Tech');
      const feed = yield* seedFeed(harness, bob.owner);

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FEEDS,
        cookie: bob.cookie,
        body: { id: feed.id, folderId: folder.id },
      });
      const listed = yield* call(harness, {
        path: FEEDS,
        cookie: bob.cookie,
      });
      const rows = yield* Effect.promise(() => readFeedRows(listed));

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderNotFound',
        message: '目录不存在，可能已被删除',
        id: folder.id,
      });
      expect(rows.items[0] !== undefined && 'folderId' in rows.items[0]).toBe(
        false
      );
    })
  )
);
