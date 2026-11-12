import { expect, it } from '@effect/vitest';
import {
  ArticleTitle,
  Feed,
  type FeedId,
  FeedItem,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
} from '@reader/business';
import { feedItemRepositoryContract } from '@reader/business/testing';
import { Effect, Exit, Option, Schema } from 'effect';
import { Database } from '../../src/infrastructure/db';
import {
  feedStoreLayer,
  owner,
  query,
  readerStoreDatabaseLayer,
  url,
} from './store-support';

const alice = owner('alice');

const decodeTitle = Schema.decodeSync(ArticleTitle);

let counter = 0;

const uniquePath = (path: string) => {
  counter += 1;

  return `https://example.com/${path}/${counter}`;
};

const storedFeed = () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = Feed.make({
      ownerId: alice,
      url: url(uniquePath('feed')),
      title: FeedTitle.make('Feed'),
      updatedAt: Option.none(),
    });
    yield* feeds.create(alice, [feed]);

    return feed;
  });

const itemRow = (feedId: FeedId) =>
  FeedItem.make({
    ownerId: alice,
    feedId,
    url: url(uniquePath('item')),
    title: decodeTitle('Item'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
  });

feedItemRepositoryContract('SurrealDB FeedItemRepository', feedStoreLayer);

it.effect('decodes a stored row without optional fields as none', () =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const db = yield* Database;
    const feed = yield* storedFeed();
    const item = itemRow(feed.id);
    yield* items.create(alice, [item]);

    expect(
      yield* query(
        db,
        'SELECT description, content, extractedContent, publishedAt FROM feed_item WHERE itemId = $id;',
        { id: item.id }
      )
    ).toEqual([{}]);

    const stored = Option.getOrThrow(yield* items.find(alice, item.id));

    expect(Option.isNone(stored.description)).toBe(true);
    expect(Option.isNone(stored.content)).toBe(true);
    expect(Option.isNone(stored.extractedContent)).toBe(true);
    expect(Option.isNone(stored.publishedAt)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('keeps one item per feed and url in the database', () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const feed = yield* storedFeed();
    const item = itemRow(feed.id);
    const create = (id: string) =>
      query(
        db,
        'CREATE feed_item SET owner = $owner, feedId = $feedId, itemId = $id, url = $url, title = "Item", read = false;',
        { owner: alice, feedId: feed.id, id, url: item.url.href }
      );

    yield* create(item.id);
    const duplicate = yield* Effect.exit(create(itemRow(feed.id).id));

    expect(Exit.isFailure(duplicate)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
