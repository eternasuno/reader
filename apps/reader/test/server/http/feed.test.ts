import { expect, it } from '@effect/vitest';
import {
  type Feed,
  type FeedId,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
  FolderRepository,
} from '@reader/business';
import {
  alice,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueFolder,
} from '@reader/business/testing';
import { Effect, Option } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { httpLayer, rawCall } from './support';

const calls: Array<FeedId> = [];

const client = () => HttpApiTest.groups(ReaderApi, ['feed']);

const seedFeed = (title = 'Feed') =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ title: FeedTitle.make(title) });
    yield* feeds.create(alice, [feed]);

    return feed;
  });

it.effect('GET /api/feeds FD-LIST-3 orders feeds by title', () =>
  Effect.gen(function* () {
    const beta = yield* seedFeed('Beta');
    const alpha = yield* seedFeed('Alpha');
    const api = yield* client();
    const body = yield* api.feed.listFeeds();

    expect(body.items.map((feed) => feed.id)).toEqual([alpha.id, beta.id]);
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds/preview FD-PREVIEW normalizes the address', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const body = yield* api.feed.previewFeed({
      payload: { url: 'https://example.com/feed?utm_source=x#top' },
    });

    expect(body.preview.url.href).toBe('https://example.com/feed');
    expect(body.preview).toMatchObject({
      title: 'Preview',
      titles: [],
    });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds/preview CM-URL-1 answers FeedUrlInvalid', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api.feed.previewFeed({
      payload: { url: 'mailto:someone@example.com' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({ _tag: 'FeedUrlInvalid' });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds FD-SUB-7 enqueues a refresh of the new feed', () =>
  Effect.gen(function* () {
    calls.length = 0;
    const api = yield* client();
    const response = yield* api.feed.subscribeFeed({
      payload: { url: 'https://example.com/feed.xml', title: '' },
      responseMode: 'response-only',
    });
    const body = (yield* response.json) as unknown as { item: Feed };

    expect(response.status).toBe(201);
    expect(body.item.title).toBe('example.com');
    expect(calls).toEqual([body.item.id]);
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds FD-SUB-2 answers 409 with the URL', () =>
  Effect.gen(function* () {
    const api = yield* client();
    yield* api.feed.subscribeFeed({
      payload: { url: 'https://example.com/feed.xml', title: 'Feed' },
    });
    const response = yield* api.feed.subscribeFeed({
      payload: { url: 'https://example.com/feed.xml', title: 'Feed' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(409);
    expect(yield* response.json).toEqual({
      _tag: 'FeedAlreadyExists',
      url: 'https://example.com/feed.xml',
    });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds FD-SUB-6 answers FolderNotFound with the id', () =>
  Effect.gen(function* () {
    const missing = makeUniqueFolder();
    const api = yield* client();
    const response = yield* api.feed.subscribeFeed({
      payload: {
        url: 'https://example.com/feed.xml',
        folderId: missing.id,
      },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(404);
    expect(yield* response.json).toEqual({
      _tag: 'FolderNotFound',
      id: missing.id,
    });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds rejects a missing field structurally', () =>
  Effect.gen(function* () {
    const response = yield* rawCall(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    );

    expect(response.status).toBe(400);
    expect(yield* Effect.promise(() => response.text())).toBe('');
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('DELETE /api/feeds/:id FD-UNSUB removes the feed', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const api = yield* client();
    const response = yield* api.feed.unsubscribeFeed({
      params: { id: feed.id },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(204);
    expect((yield* api.feed.listFeeds()).items).toEqual([]);
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('PATCH /api/feeds/:id FD-MOVE puts the feed in a folder', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const folders = yield* FolderRepository;
    const folder = makeUniqueFolder();
    yield* folders.create(alice, [folder]);
    const api = yield* client();
    const response = yield* api.feed.moveFeed({
      params: { id: feed.id },
      payload: { folderId: folder.id },
      responseMode: 'response-only',
    });
    const feeds = yield* FeedRepository;
    const moved = yield* feeds.find(alice, feed.id);

    expect(response.status).toBe(204);
    expect(Option.getOrNull(moved)?.folderId).toEqual(Option.some(folder.id));
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('PATCH /api/feeds/:id FD-MOVE-3 answers FolderNotFound', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const missing = makeUniqueFolder();
    const api = yield* client();
    const response = yield* api.feed.moveFeed({
      params: { id: feed.id },
      payload: { folderId: missing.id },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(404);
    expect(yield* response.json).toEqual({
      _tag: 'FolderNotFound',
      id: missing.id,
    });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('GET /api/feeds/unread-counts FD-COUNT-1 counts unread items', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const items = yield* FeedItemRepository;
    yield* items.create(alice, [makeUniqueFeedItem({ feedId: feed.id })]);
    const api = yield* client();

    expect(yield* api.feed.feedUnreadCounts()).toEqual({
      items: [{ feedId: feed.id, count: 1 }],
    });
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('POST /api/feeds/:id/read-all FD-READ-2 marks the feed read', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const items = yield* FeedItemRepository;
    yield* items.create(alice, [makeUniqueFeedItem({ feedId: feed.id })]);
    const api = yield* client();
    const response = yield* api.feed.markFeedRead({
      params: { id: feed.id },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(204);
    expect((yield* api.feed.feedUnreadCounts()).items).toEqual([]);
  }).pipe(Effect.provide(httpLayer({ calls })))
);

it.effect('GET /api/feeds/:id/items FD-LIST-2 pages one feed', () =>
  Effect.gen(function* () {
    const feed = yield* seedFeed();
    const items = yield* FeedItemRepository;
    const rows = [makeUniqueFeedItem({ feedId: feed.id })];
    yield* items.create(alice, rows);
    const api = yield* client();
    const body = yield* api.feed.listFeedItemsOfFeed({
      params: { id: feed.id },
      query: { limit: 10, unread: false },
    });

    expect(body.items.map((item) => item.id)).toEqual([rows[0]?.id]);
    expect(body.cursor).toBeNull();
  }).pipe(Effect.provide(httpLayer({ calls })))
);
