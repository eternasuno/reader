import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  groupFeed,
  readFailure,
  readFeedItems,
  readFeeds,
  readFolder,
  readFolders,
  readJson,
  readSavedPages,
  seedFeed,
  seedFolder,
  seedItem,
  seedPage,
  sessionFor,
} from '../../../support/fixtures';
import { type Harness, makeHarness } from '../../../support/harness';

const FOLDERS = '/api/library/folders';
const FEEDS = '/api/library/feeds';
const FEED_ITEMS = '/api/library/feeds/items';
const SAVED_PAGES = '/api/library/saved-pages';
const UNKNOWN_ID = '01234567-89ab-7cde-8123-456789abcdef';

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

it.effect('lists the folders of the signed-in owner by name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const tech = yield* seedFolder(harness, alice, 'Tech');
      const news = yield* seedFolder(harness, alice, 'News');
      yield* seedFolder(harness, bob, 'Private');

      const response = yield* call(harness, {
        path: FOLDERS,
        cookie: alice.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(response));

      expect(response.status).toBe(200);
      expect(folders.map((folder) => folder.id)).toEqual([news.id, tech.id]);
      expect(folders.map((folder) => folder.name)).toEqual(['News', 'Tech']);
      expect(folders.every((folder) => folder.ownerId === alice.owner)).toBe(
        true
      );
    })
  )
);

it.effect('creates a folder with a trimmed name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: '  Tech  ' },
      });
      const folder = yield* Effect.promise(() => readFolder(response));

      expect(response.status).toBe(201);
      expect(folder.name).toBe('Tech');
      expect(folder.ownerId).toBe(session.owner);
    })
  )
);

it.effect('rejects a blank folder name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: '   ' },
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidFolderName',
      });
    })
  )
);

it.effect('rejects a duplicate folder name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: 'Tech' },
      });

      expect(response.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderAlreadyExists',
      });
    })
  )
);

it.effect('renames a folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: folder.id, name: ' Engineering ' },
      });
      const listed = yield* call(harness, {
        path: FOLDERS,
        cookie: session.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(listed));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(response))).toEqual({
        ok: true,
      });
      expect(folders.map((item) => item.name)).toEqual(['Engineering']);
      expect(folders.map((item) => item.id)).toEqual([folder.id]);
    })
  )
);

it.effect('rejects renaming an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: UNKNOWN_ID, name: 'Tech' },
      });

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderNotFound',
        id: UNKNOWN_ID,
      });
    })
  )
);

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
