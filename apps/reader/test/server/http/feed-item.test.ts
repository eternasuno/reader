import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  type FeedItem,
  FeedItemRepository,
  FeedRepository,
} from '@reader/business';
import {
  alice,
  makeUniqueFeed,
  makeUniqueFeedItem,
} from '@reader/business/testing';
import { Effect, Option } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { httpLayer, rawCall } from './support';

const client = () => HttpApiTest.groups(ReaderApi, ['feed-item']);

const seedItems = (count: number) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed();
    yield* feeds.create(alice, [feed]);
    const items = yield* FeedItemRepository;
    const rows = Array.from({ length: count }, () =>
      makeUniqueFeedItem({ feedId: feed.id })
    );
    yield* items.create(alice, rows);

    return rows;
  });

it.effect('GET /api/feed-items FD-LIST pages all items newest first', () =>
  Effect.gen(function* () {
    const rows = yield* seedItems(2);
    const api = yield* client();
    const first = yield* api['feed-item'].listFeedItems({
      query: { limit: 1, unread: false },
    });

    expect(first.items.map((item) => item.id)).toEqual([rows[1]?.id]);
    expect(first.cursor).toBe(rows[1]?.id);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/feed-items CM-PAGE-5 rejects a malformed cursor', () =>
  Effect.gen(function* () {
    const response = yield* rawCall(
      new Request('http://localhost/api/feed-items?limit=10&cursor=nope')
    );

    expect(response.status).toBe(400);
    expect(yield* Effect.promise(() => response.text())).toBe('');
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/feed-items/:id FD-OPEN answers the item or null', () =>
  Effect.gen(function* () {
    const rows = yield* seedItems(1);
    const item = rows[0] as FeedItem;
    const api = yield* client();
    const found = yield* api['feed-item'].getFeedItem({
      params: { id: item.id },
    });
    const missing = yield* api['feed-item'].getFeedItem({
      params: { id: makeUniqueFeedItem().id },
    });

    expect(found.item?.id).toBe(item.id);
    expect(missing.item).toBeNull();
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PATCH /api/feed-items/:id FD-READ stores the read state', () =>
  Effect.gen(function* () {
    const rows = yield* seedItems(1);
    const item = rows[0] as FeedItem;
    const api = yield* client();
    const response = yield* api['feed-item'].markFeedItem({
      params: { id: item.id },
      payload: { read: true },
      responseMode: 'response-only',
    });
    const items = yield* FeedItemRepository;
    const stored = yield* items.find(alice, item.id);

    expect(response.status).toBe(204);
    expect(Option.getOrNull(stored)?.read).toBe(true);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/feed-items/read FD-READ-1 marks the given ids', () =>
  Effect.gen(function* () {
    const rows = yield* seedItems(2);
    const api = yield* client();
    const response = yield* api['feed-item'].markFeedItems({
      payload: { ids: rows.map((row) => row.id) },
      responseMode: 'response-only',
    });
    const list = yield* api['feed-item'].listFeedItems({
      query: { limit: 10, unread: true },
    });

    expect(response.status).toBe(204);
    expect(list.items).toEqual([]);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/feed-items/read-all FD-READ marks every item', () =>
  Effect.gen(function* () {
    yield* seedItems(2);
    const api = yield* client();
    const response = yield* api['feed-item'].markAllFeedItems({
      responseMode: 'response-only',
    });
    const unread = yield* api['feed-item'].listFeedItems({
      query: { limit: 10, unread: true },
    });

    expect(response.status).toBe(204);
    expect(unread.items).toEqual([]);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'POST /api/feed-items/:id/extract FD-EXTRACT stores the article',
  () =>
    Effect.gen(function* () {
      const rows = yield* seedItems(1);
      const item = rows[0] as FeedItem;
      const api = yield* client();
      const first = yield* api['feed-item'].extractFeedItem({
        params: { id: item.id },
      });
      const again = yield* api['feed-item'].extractFeedItem({
        params: { id: item.id },
      });

      expect(first.item.extractedContent).toEqual(Option.some('<p>Body</p>'));
      expect(again.item.extractedContent).toEqual(first.item.extractedContent);
      expect(first.item.content).toEqual(Option.none());
    }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/feed-items/:id/extract FD-EXTRACT-1 answers 404', () =>
  Effect.gen(function* () {
    const missing = makeUniqueFeedItem();
    const api = yield* client();
    const response = yield* api['feed-item'].extractFeedItem({
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

it.effect(
  'POST /api/feed-items/:id/extract CM-FETCH-4 maps a parse failure',
  () =>
    Effect.gen(function* () {
      const rows = yield* seedItems(1);
      const item = rows[0] as FeedItem;
      const api = yield* client();
      const response = yield* api['feed-item'].extractFeedItem({
        params: { id: item.id },
        responseMode: 'response-only',
      });

      expect(response.status).toBe(422);
      expect(yield* response.json).toEqual({ _tag: 'ArticleExtractorError' });
    }).pipe(Effect.provide(httpLayer({ parseFails: true })))
);

it.effect(
  'POST /api/feed-items/:id/extract CM-ART-5 answers empty content',
  () =>
    Effect.gen(function* () {
      const rows = yield* seedItems(1);
      const item = rows[0] as FeedItem;
      const api = yield* client();
      const response = yield* api['feed-item'].extractFeedItem({
        params: { id: item.id },
        responseMode: 'response-only',
      });

      expect(response.status).toBe(422);
      expect(yield* response.json).toEqual({ _tag: 'ArticleEmptyContent' });
    }).pipe(Effect.provide(httpLayer({ extractEmpty: true })))
);

it.effect(
  'POST /api/feed-items/:id/extract FD-EXTRACT-2 CM-FETCH-2 skips settings on cached extraction',
  () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = makeUniqueFeed();
      yield* feeds.create(alice, [feed]);
      const items = yield* FeedItemRepository;
      const item = makeUniqueFeedItem({
        feedId: feed.id,
        extractedContent: Option.some(ArticleContent.make('<p>Cached</p>')),
      });
      yield* items.create(alice, [item]);
      const api = yield* client();
      const body = yield* api['feed-item'].extractFeedItem({
        params: { id: item.id },
      });

      expect(body.item.extractedContent).toEqual(Option.some('<p>Cached</p>'));
    }).pipe(Effect.provide(httpLayer({ settingFails: true })))
);
