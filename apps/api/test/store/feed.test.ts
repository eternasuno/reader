import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleTitle,
  Feed,
  FeedItem,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
  SavedPage,
  SavedPageRepository,
} from '@reader/business';
import { feedRepositoryContract } from '@reader/business/testing';
import { DateTime, Effect, Option, Schema } from 'effect';
import { Database } from '../../src/db';
import {
  feedStoreLayer,
  owner,
  query,
  readerStoreDatabaseLayer,
  url,
} from '../support/store';

const alice = owner('alice');

const decodeTitle = Schema.decodeSync(ArticleTitle);

const feedRow = (path: string) =>
  Feed.make({
    ownerId: alice,
    url: url(path),
    title: FeedTitle.make('Feed'),
    folderId: Option.none(),
    updatedAt: Option.none(),
  });

feedRepositoryContract('SurrealDB FeedRepository', feedStoreLayer);

it.effect('stores the feed id as the record id and the url as text', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const db = yield* Database;
    const feed = feedRow('https://example.com/feed.xml');
    const updated = Feed.make({
      ...feedRow('https://example.com/updated.xml'),
      updatedAt: Option.some(
        DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z'))
      ),
    });

    yield* feeds.create(alice, [feed]);
    yield* feeds.create(alice, [updated]);

    expect(
      yield* query(db, 'SELECT VALUE id FROM feed WHERE feedId = $id;', {
        id: updated.id,
      })
    ).toEqual([updated.id]);
    expect(
      yield* query(db, 'SELECT VALUE url FROM feed ORDER BY url;')
    ).toEqual([feed.url.href, updated.url.href].sort());
    expect(
      yield* query(
        db,
        'SELECT VALUE type::is_datetime(updatedAt) FROM feed WHERE updatedAt != NONE;'
      )
    ).toEqual([true]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('FD-UNSUB-3 keeps saved pages made from a removed feed', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const pages = yield* SavedPageRepository;
    const feed = feedRow('https://example.com/unsub/feed.xml');
    const item = FeedItem.make({
      ownerId: alice,
      feedId: feed.id,
      url: url('https://example.com/unsub/item'),
      title: decodeTitle('Item'),
      description: Option.none(),
      content: Option.none(),
      extractedContent: Option.none(),
      publishedAt: Option.none(),
      read: false,
    });
    const page = SavedPage.make({
      ownerId: alice,
      url: item.url,
      title: item.title,
      description: Option.none(),
      content: ArticleContent.make('<p>Body</p>'),
      publishedAt: Option.none(),
      read: false,
    });
    yield* feeds.create(alice, [feed]);
    yield* items.create(alice, [item]);
    yield* pages.create(alice, [page]);

    yield* feeds.remove(alice, [feed.id]);

    expect(Option.isNone(yield* items.find(alice, item.id))).toBe(true);
    expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(page);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
