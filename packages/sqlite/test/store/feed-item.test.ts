import { expect, it } from '@effect/vitest';
import {
  ArticleTitle,
  Feed,
  type FeedId,
  FeedItem,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
  NormalizedUrl,
  OwnerId,
} from '@reader/business';
import { feedItemRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { feedStoreLayer, readerStoreDatabaseLayer } from '../support';

const alice = OwnerId.make('alice');

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeTitle = Schema.decodeSync(ArticleTitle);

const feedUrl = decodeUrl('https://example.com/feed.xml');

const itemUrl = decodeUrl('https://example.com/item');

const storedFeed = () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = Feed.make({
      ownerId: alice,
      url: feedUrl,
      title: FeedTitle.make('Feed'),
      folderId: Option.none(),
      updatedAt: Option.none(),
    });
    yield* feeds.create(alice, [feed]);

    return feed;
  });

const clearedItem = (feedId: FeedId) =>
  FeedItem.make({
    ownerId: alice,
    feedId,
    url: itemUrl,
    title: decodeTitle('Item'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
  });

feedItemRepositoryContract('SQLite FeedItemRepository', feedStoreLayer);

it.effect('decodes a stored row without optional fields as none', () =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const sql = yield* SqlClient.SqlClient;
    const feed = yield* storedFeed();
    const item = clearedItem(feed.id);
    yield* items.create(alice, [item]);

    const rows =
      yield* sql`SELECT description, content, extracted_content AS extractedContent, published_at AS publishedAt FROM feed_item WHERE id = ${item.id}`;

    expect(rows).toEqual([
      {
        description: null,
        content: null,
        extractedContent: null,
        publishedAt: null,
      },
    ]);

    const stored = Option.getOrThrow(yield* items.find(alice, item.id));

    expect(Option.isNone(stored.description)).toBe(true);
    expect(Option.isNone(stored.content)).toBe(true);
    expect(Option.isNone(stored.extractedContent)).toBe(true);
    expect(Option.isNone(stored.publishedAt)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
