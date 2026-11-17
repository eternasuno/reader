import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  FeedItemRepository,
  FeedRepository,
  type SavedPage,
  SavedPageRepository,
} from '@reader/business';
import {
  alice,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueSavedPage,
} from '@reader/business/testing';
import { Effect, Option } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { httpLayer, rawCall } from './support';

const client = () => HttpApiTest.groups(ReaderApi, ['saved-page']);

const seedPages = (count: number) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const rows = Array.from({ length: count }, () => makeUniqueSavedPage());

    yield* pages.create(alice, rows);

    return rows;
  });

it.effect('GET /api/saved-pages SP-LIST-1 pages newest first', () =>
  Effect.gen(function* () {
    const rows = yield* seedPages(2);
    const api = yield* client();
    const first = yield* api['saved-page'].listSavedPages({
      query: { limit: 1, unread: false },
    });

    expect(first.items.map((row) => row.id)).toEqual([rows[1]?.id]);
    expect(first.cursor).toBe(rows[1]?.id);

    const second = yield* api['saved-page'].listSavedPages({
      query: { limit: 1, unread: false, cursor: first.cursor ?? undefined },
    });

    expect(second.items.map((row) => row.id)).toEqual([rows[0]?.id]);
    expect(second.cursor).toBeNull();
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/saved-pages rejects a bad limit structurally', () =>
  Effect.gen(function* () {
    const response = yield* rawCall(
      new Request('http://localhost/api/saved-pages?limit=0')
    );

    expect(response.status).toBe(400);
    expect(yield* Effect.promise(() => response.text())).toBe('');
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/saved-pages/unread-count SP-COUNT-1 counts unread', () =>
  Effect.gen(function* () {
    const rows = yield* seedPages(1);
    const pages = yield* SavedPageRepository;
    yield* pages.markRead(alice, [(rows[0] as SavedPage).id], true);
    yield* seedPages(1);
    const api = yield* client();

    expect(yield* api['saved-page'].savedPageUnreadCount()).toEqual({
      count: 1,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'GET /api/saved-pages/lookup SP-ID-4 finds by URL, bad URL is null',
  () =>
    Effect.gen(function* () {
      const rows = yield* seedPages(1);
      const page = rows[0] as SavedPage;
      const api = yield* client();
      const found = yield* api['saved-page'].lookupSavedPage({
        query: { url: page.url.href },
      });
      const invalid = yield* api['saved-page'].lookupSavedPage({
        query: { url: 'not a url' },
      });

      expect(found.item?.id).toBe(page.id);
      expect(invalid.item).toBeNull();
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'GET /api/saved-pages/:id SP-OPEN answers null for an unknown id',
  () =>
    Effect.gen(function* () {
      const api = yield* client();
      const unknown = yield* api['saved-page'].getSavedPage({
        params: { id: makeUniqueSavedPage().id },
      });

      expect(unknown.item).toBeNull();
    }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages SP-ADD stores the extracted article', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api['saved-page'].addSavedPage({
      payload: { url: 'https://example.com/article?utm_source=x#top' },
      responseMode: 'response-only',
    });
    const body = yield* response.json;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      item: {
        url: 'https://example.com/article',
        title: 'Article',
        content: '<p>Body</p>',
        read: false,
      },
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages SP-ADD-5 answers 409 with the URL', () =>
  Effect.gen(function* () {
    const api = yield* client();
    yield* api['saved-page'].addSavedPage({
      payload: { url: 'https://example.com/page' },
    });
    const response = yield* api['saved-page'].addSavedPage({
      payload: { url: 'https://example.com/page?utm_medium=mail' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(409);
    expect(yield* response.json).toEqual({
      _tag: 'SavedPageAlreadyExists',
      url: 'https://example.com/page',
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages CM-URL-1 answers InvalidPageUrl', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api['saved-page'].addSavedPage({
      payload: { url: 'not a url' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({ _tag: 'InvalidPageUrl' });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/feed-items/:id/save SP-SAVE copies the item', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed();
    yield* feeds.create(alice, [feed]);
    const items = yield* FeedItemRepository;
    const item = makeUniqueFeedItem({
      feedId: feed.id,
      content: Option.some(ArticleContent.make('<p>Item</p>')),
    });
    yield* items.create(alice, [item]);
    const api = yield* client();
    const body = yield* api['saved-page'].saveFeedItem({
      params: { id: item.id },
    });

    expect(body.item).toMatchObject({
      url: item.url,
      content: '<p>Item</p>',
      read: false,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/feed-items/:id/save answers 404 with the id', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const missing = makeUniqueFeedItem();
    const response = yield* api['saved-page'].saveFeedItem({
      params: { id: missing.id },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(404);
    expect(yield* response.json).toEqual({
      _tag: 'FeedItemNotFound',
      id: missing.id,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PATCH /api/saved-pages/:id SP-READ stores the read state', () =>
  Effect.gen(function* () {
    const rows = yield* seedPages(1);
    const page = rows[0] as SavedPage;
    const api = yield* client();
    const response = yield* api['saved-page'].markSavedPage({
      params: { id: page.id },
      payload: { read: true },
      responseMode: 'response-only',
    });
    const pages = yield* SavedPageRepository;
    const stored = yield* pages.find(alice, page.id);

    expect(response.status).toBe(204);
    expect(Option.getOrNull(stored)?.read).toBe(true);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages/read SP-READ-1 marks the given ids', () =>
  Effect.gen(function* () {
    const rows = yield* seedPages(2);
    const api = yield* client();
    const response = yield* api['saved-page'].markSavedPages({
      payload: { ids: rows.map((row) => row.id) },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(204);
    expect(yield* api['saved-page'].savedPageUnreadCount()).toEqual({
      count: 0,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages/read-all SP-READ-3 marks every page', () =>
  Effect.gen(function* () {
    yield* seedPages(2);
    const api = yield* client();
    const response = yield* api['saved-page'].markAllSavedPages({
      responseMode: 'response-only',
    });

    expect(response.status).toBe(204);
    expect(yield* api['saved-page'].savedPageUnreadCount()).toEqual({
      count: 0,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('DELETE /api/saved-pages/:id SP-REMOVE-1 removes the page', () =>
  Effect.gen(function* () {
    const rows = yield* seedPages(1);
    const page = rows[0] as SavedPage;
    const api = yield* client();
    const response = yield* api['saved-page'].removeSavedPage({
      params: { id: page.id },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(204);
    expect(
      yield* api['saved-page'].getSavedPage({
        params: { id: page.id },
      })
    ).toEqual({ item: null });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/saved-pages CM-FETCH-4 answers WebpageFetcherError', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api['saved-page'].addSavedPage({
      payload: { url: 'https://example.com/down' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(422);
    expect(yield* response.json).toEqual({
      _tag: 'WebpageFetcherError',
    });
  }).pipe(Effect.provide(httpLayer({ fetchStatus: 500 })))
);

it.effect(
  'POST /api/feed-items/:id/save SP-SAVE-8 CM-FETCH-2 skips settings when stored content exists',
  () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = makeUniqueFeed();
      yield* feeds.create(alice, [feed]);
      const items = yield* FeedItemRepository;
      const item = makeUniqueFeedItem({
        feedId: feed.id,
        content: Option.some(ArticleContent.make('<p>Stored</p>')),
      });
      yield* items.create(alice, [item]);
      const api = yield* client();
      const body = yield* api['saved-page'].saveFeedItem({
        params: { id: item.id },
      });

      expect(body.item).toMatchObject({
        url: item.url,
        content: '<p>Stored</p>',
        read: false,
      });
    }).pipe(Effect.provide(httpLayer({ settingFails: true })))
);

it.effect(
  'POST /api/feed-items/:id/save CM-FETCH-4 answers SettingRepositoryError when fetching',
  () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = makeUniqueFeed();
      yield* feeds.create(alice, [feed]);
      const items = yield* FeedItemRepository;
      const item = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [item]);
      const api = yield* client();
      const response = yield* api['saved-page'].saveFeedItem({
        params: { id: item.id },
        responseMode: 'response-only',
      });

      expect(response.status).toBe(500);
      expect(yield* response.json).toEqual({ _tag: 'SettingRepositoryError' });
    }).pipe(Effect.provide(httpLayer({ settingFails: true })))
);
