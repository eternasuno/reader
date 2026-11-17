import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleTitle,
  Feed,
  FeedItem,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
  NormalizedUrl,
  OwnerId,
  SavedPage,
  SavedPageRepository,
} from '@reader/business';
import { feedRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { feedStoreLayer, readerStoreDatabaseLayer } from '../support';

const alice = OwnerId.make('alice');

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeTitle = Schema.decodeSync(ArticleTitle);

feedRepositoryContract('SQLite FeedRepository', feedStoreLayer);

it.effect('decodes a feed without folder and updated time as none', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = Feed.make({
      ownerId: alice,
      url: decodeUrl('https://example.com/sqlite/feed.xml'),
      title: FeedTitle.make('Feed'),
      folderId: Option.none(),
      updatedAt: Option.none(),
    });
    yield* feeds.create(alice, [feed]);

    const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

    expect(Option.isNone(stored.folderId)).toBe(true);
    expect(Option.isNone(stored.updatedAt)).toBe(true);
  }).pipe(Effect.provide(feedStoreLayer))
);

it.effect('FD-UNSUB-3 keeps saved pages made from a removed feed', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const pages = yield* SavedPageRepository;
    const feed = Feed.make({
      ownerId: alice,
      url: decodeUrl('https://example.com/unsub/feed.xml'),
      title: FeedTitle.make('Feed'),
      folderId: Option.none(),
      updatedAt: Option.none(),
    });
    const item = FeedItem.make({
      ownerId: alice,
      feedId: feed.id,
      url: decodeUrl('https://example.com/unsub/item'),
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
    expect(yield* pages.find(alice, page.id)).toStrictEqual(Option.some(page));
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
