import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../../src/entity/feed/feed-item';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../src/port/feed-item-repository';
import type { FeedRepositoryError } from '../../../src/port/feed-repository';
import { listItems } from '../../../src/usecase/feed/list-items';
import {
  alice,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
  makeUniqueFeedItem,
} from '../../support';
import { run, storeFeed, storeItems, urlsOf } from './support';

const base = 'https://example.com';

const url = (path: string): string => `${base}/${path}`;

type ItemPage = {
  readonly items: ReadonlyArray<FeedItem>;
  readonly cursor: FeedItemId | null;
};

const itemsOf = (
  feed: Feed,
  paths: ReadonlyArray<string>
): ReadonlyArray<FeedItem> =>
  paths.map((path) =>
    makeFeedItem({
      ownerId: feed.ownerId,
      feedId: feed.id,
      url: decodeUrl(url(path)),
    })
  );

const cursorOf = (page: ItemPage): FeedItemId => {
  if (page.cursor === null) {
    throw new Error('expected a page cursor');
  }

  return page.cursor;
};

const pageOf = (
  feed: Feed,
  paths: ReadonlyArray<string>,
  limit: number
): Effect.Effect<ItemPage, FeedItemRepositoryError | FeedRepositoryError> =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* storeItems(alice, itemsOf(feed, paths));

      return yield* listItems(alice, {
        feedId: feed.id,
        unreadOnly: false,
        limit,
      });
    })
  );

describe('listItems paging', () => {
  it.effect('walks the newest first list with a cursor', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);
          yield* storeItems(alice, itemsOf(feed, ['one', 'two', 'three']));

          const first = yield* listItems(alice, {
            feedId: feed.id,
            unreadOnly: false,
            limit: 2,
          });
          const second = yield* listItems(alice, {
            feedId: feed.id,
            unreadOnly: false,
            limit: 2,
            cursor: cursorOf(first),
          });

          return { first, second };
        })
      );

      expect(urlsOf(result.first.items)).toEqual([url('three'), url('two')]);
      expect(urlsOf(result.second.items)).toEqual([url('one')]);
      expect(result.second.cursor).toBeNull();
    })
  );
});

describe('listItems full page', () => {
  it.effect('returns no cursor when the page is exactly full', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const page = yield* pageOf(feed, ['one', 'two'], 2);

      expect(urlsOf(page.items)).toEqual([url('two'), url('one')]);
      expect(page.cursor).toBeNull();
    })
  );

  it.effect('limits the page and reports a cursor when more rows exist', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const page = yield* pageOf(feed, ['one', 'two', 'three', 'four'], 3);

      expect(urlsOf(page.items)).toEqual([
        url('four'),
        url('three'),
        url('two'),
      ]);
      expect(page.cursor).not.toBeNull();
    })
  );
});

describe('listItems feed filter', () => {
  it.effect('lists only the items of the given feed', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const other = makeUniqueFeed({ ownerId: alice });
      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);
          yield* storeFeed(other);
          yield* storeItems(alice, itemsOf(feed, ['one']));
          yield* storeItems(alice, itemsOf(other, ['other']));

          return {
            oneFeed: yield* listItems(alice, {
              feedId: feed.id,
              unreadOnly: false,
              limit: 10,
            }),
            allFeeds: yield* listItems(alice, {
              unreadOnly: false,
              limit: 10,
            }),
          };
        })
      );

      expect(urlsOf(result.oneFeed.items)).toEqual([url('one')]);
      expect(result.allFeeds.items).toHaveLength(2);
    })
  );

  it.effect('returns an empty page for an unknown feed', () =>
    Effect.gen(function* () {
      const missing = makeUniqueFeed({ ownerId: alice });
      const page = yield* run(
        listItems(alice, {
          feedId: missing.id,
          unreadOnly: false,
          limit: 10,
        })
      );

      expect(page.items).toEqual([]);
      expect(page.cursor).toBeNull();
    })
  );
});

describe('listItems unread filter', () => {
  it.effect('lists unread items only when requested', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const read = makeUniqueFeedItem({ ownerId: alice, feedId: feed.id });
      const result = yield* run(
        Effect.gen(function* () {
          const items = yield* FeedItemRepository;

          yield* storeFeed(feed);
          yield* storeItems(alice, [read, ...itemsOf(feed, ['unread'])]);
          yield* items.update(alice, [read.id], { read: true });

          return {
            unread: yield* listItems(alice, {
              feedId: feed.id,
              unreadOnly: true,
              limit: 10,
            }),
            all: yield* listItems(alice, {
              feedId: feed.id,
              unreadOnly: false,
              limit: 10,
            }),
          };
        })
      );

      expect(urlsOf(result.unread.items)).toEqual([url('unread')]);
      expect(result.all.items).toHaveLength(2);
      expect(
        result.all.items.some((item) => item.id === read.id && item.read)
      ).toBe(true);
    })
  );
});
