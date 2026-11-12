import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../../src/entity/feed/feed-item';
import type { FolderId } from '../../../src/entity/feed/folder';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../src/port/feed-item-repository';
import type {
  FeedRepository,
  FeedRepositoryError,
} from '../../../src/port/feed-repository';
import { FeedItemScope, listItems } from '../../../src/usecase/feed/list-items';
import {
  alice,
  bob,
  decodeUrl,
  makeFeedItem,
  makeFolder,
  makeUniqueFeed,
  makeUniqueFeedItem,
  storedFolder,
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
        scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
        unreadOnly: false,
        limit,
      });
    })
  );

const seedFeed = (
  owner: OwnerId,
  folderId: Option.Option<FolderId>,
  paths: ReadonlyArray<string>
): Effect.Effect<
  void,
  FeedItemRepositoryError | FeedRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feed = makeUniqueFeed({ ownerId: owner, folderId });

    yield* storeFeed(feed);
    yield* storeItems(owner, itemsOf(feed, paths));
  });

const folderScope = (folderId: FolderId) =>
  FeedItemScope.cases.Folder.make({ folderId });

const listFolder = (
  folderId: FolderId,
  limit: number,
  cursor?: FeedItemId
): ReturnType<typeof listItems> =>
  listItems(alice, {
    scope: folderScope(folderId),
    unreadOnly: false,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  });

describe('listItems paging', () => {
  it.effect('CM-PAGE-4 walks the newest first list with a cursor', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const result = yield* run(
        Effect.gen(function* () {
          yield* storeFeed(feed);
          yield* storeItems(alice, itemsOf(feed, ['one', 'two', 'three']));

          const first = yield* listItems(alice, {
            scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
            unreadOnly: false,
            limit: 2,
          });
          const second = yield* listItems(alice, {
            scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
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
  it.effect('CM-PAGE-4 limits the page and reports a cursor', () =>
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

  it.effect('CM-PAGE-4 returns no cursor when the page is exactly full', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const page = yield* pageOf(feed, ['one', 'two', 'three'], 3);

      expect(page.items).toHaveLength(3);
      expect(page.cursor).toBeNull();
    })
  );
});

describe('listItems feed filter', () => {
  it.effect('FD-LIST-1 lists only the items of the given feed', () =>
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
              scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
              unreadOnly: false,
              limit: 10,
            }),
            allFeeds: yield* listItems(alice, {
              scope: FeedItemScope.cases.All.make({}),
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
});

describe('listItems folder scope', () => {
  it.effect('FD-LIST-1 lists the items of every feed in the folder', () =>
    Effect.gen(function* () {
      const page = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const other = yield* storedFolder(alice);

          yield* seedFeed(alice, Option.some(folder.id), ['one']);
          yield* seedFeed(alice, Option.some(folder.id), ['two']);
          yield* seedFeed(alice, Option.none(), ['top']);
          yield* seedFeed(alice, Option.some(other.id), ['other']);

          return yield* listFolder(folder.id, 10);
        })
      );

      expect(urlsOf(page.items)).toEqual([url('two'), url('one')]);
      expect(page.cursor).toBeNull();
    })
  );

  it.effect('CM-PAGE-4 the folder scope pages with a cursor', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);

          yield* seedFeed(alice, Option.some(folder.id), [
            'one',
            'two',
            'three',
          ]);

          const first = yield* listFolder(folder.id, 2);

          return {
            first,
            second: yield* listFolder(folder.id, 2, cursorOf(first)),
          };
        })
      );

      expect(urlsOf(result.first.items)).toEqual([url('three'), url('two')]);
      expect(urlsOf(result.second.items)).toEqual([url('one')]);
      expect(result.second.cursor).toBeNull();
    })
  );
});

describe('listItems unknown folders', () => {
  it.effect('FD-LIST-7 an unknown folder gives an empty page', () =>
    Effect.gen(function* () {
      const unknown = makeFolder({ ownerId: alice }).id;
      const page = yield* run(listFolder(unknown, 10));

      expect(page.items).toHaveLength(0);
      expect(page.cursor).toBeNull();
    })
  );

  it.effect("FD-LIST-7 another owner's folder gives an empty page", () =>
    Effect.gen(function* () {
      const page = yield* run(
        Effect.gen(function* () {
          const theirs = yield* storedFolder(bob);

          yield* seedFeed(bob, Option.some(theirs.id), ['secret']);

          return yield* listFolder(theirs.id, 10);
        })
      );

      expect(page.items).toHaveLength(0);
      expect(page.cursor).toBeNull();
    })
  );
});

describe('listItems unread filter', () => {
  it.effect('CM-PAGE-8 lists unread items only when requested', () =>
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
              scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
              unreadOnly: true,
              limit: 10,
            }),
            all: yield* listItems(alice, {
              scope: FeedItemScope.cases.Feed.make({ feedId: feed.id }),
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
