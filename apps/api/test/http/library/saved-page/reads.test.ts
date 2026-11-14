import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  call,
  itemAt,
  readCreatedSavedPage,
  readNullableSavedPage,
  readSavedPage,
  readSavedPages,
  readUnreadCount,
  requiredCursor,
  seedFeed,
  seedItem,
  seedPage,
  seedPages,
  sessionFor,
} from '../../../support/fixtures';
import { makeHarness } from '../../../support/harness';

const SAVED_PAGES = '/api/library/saved-pages';
const SAVED_PAGE = '/api/library/saved-pages/item';
const SAVED_PAGE_BY_URL = '/api/library/saved-pages/by-url';
const SAVED_PAGE_UNREAD = '/api/library/saved-pages/unread';
const FROM_FEED_ITEM = '/api/library/saved-pages/from-feed-item';

it.effect('lists unread saved pages one page at a time', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const pages = yield* seedPages(harness, session.owner, 2);
      yield* seedPage(harness, session.owner, { read: true });

      const first = yield* call(harness, {
        path: SAVED_PAGES,
        cookie: session.cookie,
        query: { unreadOnly: true, limit: 1 },
      });
      const firstPage = yield* Effect.promise(() => readSavedPages(first));

      expect(first.status).toBe(200);
      expect(firstPage.items.map((page) => page.id)).toEqual([
        itemAt(pages, 1).id,
      ]);
      expect(firstPage.cursor).not.toBeNull();

      const next = yield* call(harness, {
        path: SAVED_PAGES,
        cookie: session.cookie,
        query: {
          unreadOnly: true,
          limit: 1,
          cursor: requiredCursor(firstPage),
        },
      });
      const nextPage = yield* Effect.promise(() => readSavedPages(next));

      expect(nextPage.items.map((page) => page.id)).toEqual([
        itemAt(pages, 0).id,
      ]);
      expect(nextPage.cursor).toBeNull();
    })
  )
);

it.effect('returns the own saved page by id', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const seeded = yield* seedPage(harness, session.owner, {
        url: 'https://example.com/opened?utm_source=x',
        title: 'Opened page',
        description: 'A saved description',
        content: '<p>Opened body</p>',
        read: true,
      });

      const response = yield* call(harness, {
        path: SAVED_PAGE,
        cookie: session.cookie,
        query: { id: seeded.id },
      });
      const item = yield* Effect.promise(() => readSavedPage(response));

      expect(response.status).toBe(200);
      expect(item.id).toBe(seeded.id);
      expect(item.url.href).toBe('https://example.com/opened');
      expect(item.title).toBe('Opened page');
      expect(item.content).toBe('<p>Opened body</p>');
      expect(item.read).toBe(true);
      expect(Option.getOrThrow(item.description)).toBe('A saved description');
    })
  )
);

it.effect('finds a saved page by its normalized url', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const created = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: 'https://example.com/post?utm_source=x#top' },
      });
      const item = yield* Effect.promise(() => readCreatedSavedPage(created));

      const response = yield* call(harness, {
        path: SAVED_PAGE_BY_URL,
        cookie: session.cookie,
        query: { url: 'https://example.com/post?utm_campaign=y' },
      });
      const found = yield* Effect.promise(() =>
        readNullableSavedPage(response)
      );

      expect(created.status).toBe(201);
      expect(response.status).toBe(200);
      expect(found?.id).toBe(item.id);
    })
  )
);

it.effect('adds a link as an unread page with the fetched article', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: SAVED_PAGES,
        cookie: session.cookie,
        body: { url: ' https://example.com/post?utm_source=x#top ' },
      });
      const item = yield* Effect.promise(() => readCreatedSavedPage(response));
      const unread = yield* call(harness, {
        path: SAVED_PAGE_UNREAD,
        cookie: session.cookie,
      });

      expect(response.status).toBe(201);
      expect(item.url.href).toBe('https://example.com/post');
      expect(item.read).toBe(false);
      expect(item.title).toBe('Example article');
      expect(item.content).toContain('example article body');
      expect(yield* Effect.promise(() => readUnreadCount(unread))).toEqual({
        count: 1,
      });
    })
  )
);

it.effect('copies a feed item into an unread page', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, session.owner);
      const item = yield* seedItem(harness, session.owner, feed.id, {
        url: 'https://example.com/feed-article',
        title: 'Feed article',
        description: 'Feed summary',
        content: '<p>Feed body</p>',
      });

      const response = yield* call(harness, {
        method: 'POST',
        path: FROM_FEED_ITEM,
        cookie: session.cookie,
        body: { id: item.id },
      });
      const copy = yield* Effect.promise(() => readCreatedSavedPage(response));

      expect(response.status).toBe(201);
      expect(copy.url.href).toBe('https://example.com/feed-article');
      expect(copy.title).toBe('Feed article');
      expect(copy.content).toBe('<p>Feed body</p>');
      expect(copy.read).toBe(false);
      expect(Option.getOrThrow(copy.description)).toBe('Feed summary');
    })
  )
);
