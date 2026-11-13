import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../../src/entity/feed/feed-item';
import type { FolderId } from '../../../src/entity/feed/folder';
import type {
  FeedItemRepository,
  FeedItemRepositoryError,
} from '../../../src/port/feed-item-repository';
import type {
  FeedRepository,
  FeedRepositoryError,
} from '../../../src/port/feed-repository';
import {
  listAllItems,
  listFeedItems,
  listFolderItems,
} from '../../../src/usecase/feed/list-items';
import {
  alice,
  decodeUrl,
  makeFeedItem,
  makeUniqueFeed,
  storedFolder,
} from '../../support/fixtures';
import { run, storeFeed, storeItems, urlsOf } from '../../support/usecase/feed';

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

const feedPageOf = (
  feed: Feed,
  paths: ReadonlyArray<string>,
  limit: number
): Effect.Effect<ItemPage, FeedItemRepositoryError | FeedRepositoryError> =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* storeItems(alice, itemsOf(feed, paths));

      return yield* listFeedItems(alice, feed.id, {
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

const listFolder = (
  folderId: FolderId,
  limit: number,
  cursor?: FeedItemId
): ReturnType<typeof listFolderItems> =>
  listFolderItems(alice, folderId, {
    unreadOnly: false,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  });

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
          oneFeed: yield* listFeedItems(alice, feed.id, {
            unreadOnly: false,
            limit: 10,
          }),
          allFeeds: yield* listAllItems(alice, {
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

it.effect('CM-PAGE-4 walks the newest first list with a cursor', () =>
  Effect.gen(function* () {
    const feed = makeUniqueFeed({ ownerId: alice });
    const result = yield* run(
      Effect.gen(function* () {
        yield* storeFeed(feed);
        yield* storeItems(alice, itemsOf(feed, ['one', 'two', 'three']));

        const first = yield* listFeedItems(alice, feed.id, {
          unreadOnly: false,
          limit: 2,
        });
        const second = yield* listFeedItems(alice, feed.id, {
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

it.effect('CM-PAGE-4 returns no cursor when the page is exactly full', () =>
  Effect.gen(function* () {
    const feed = makeUniqueFeed({ ownerId: alice });
    const page = yield* feedPageOf(feed, ['one', 'two', 'three'], 3);

    expect(page.items).toHaveLength(3);
    expect(page.cursor).toBeNull();
  })
);

it.effect('CM-PAGE-4 the folder scope pages with a cursor', () =>
  Effect.gen(function* () {
    const result = yield* run(
      Effect.gen(function* () {
        const folder = yield* storedFolder(alice);

        yield* seedFeed(alice, Option.some(folder.id), ['one', 'two', 'three']);

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
