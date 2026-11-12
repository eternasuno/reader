import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Result } from 'effect';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FolderId } from '../../../src/entity/feed/folder';
import { FolderNotFound } from '../../../src/usecase/feed/errors';
import { FeedItemScope, listItems } from '../../../src/usecase/feed/list-items';
import { moveFeed } from '../../../src/usecase/feed/move-feed';
import {
  alice,
  bob,
  makeFolder,
  makeUniqueFeed,
  makeUniqueFeedItem,
  storedFeed,
  storedFolder,
} from '../../support';
import {
  findFeed,
  run,
  storedItems,
  storeFeed,
  storeItems,
  urlsOf,
} from './support';

const feedIn = (folderId: FolderId): Feed =>
  makeUniqueFeed({ folderId: Option.some(folderId) });

const itemInFolder = (folderId: FolderId): ReturnType<typeof listItems> =>
  listItems(alice, {
    scope: FeedItemScope.cases.Folder.make({ folderId }),
    unreadOnly: false,
    limit: 10,
  });

const folderOf = (feed: Option.Option<Feed>): Option.Option<FolderId> =>
  Option.flatMap(feed, (row) => row.folderId);

describe('moveFeed', () => {
  it.effect('FD-MOVE-1 puts a top-level feed into a folder', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const feed = yield* storedFeed(alice);

          yield* moveFeed(alice, feed.id, Option.some(folder.id));

          return { folder, stored: yield* findFeed(alice, feed.id) };
        })
      );

      expect(folderOf(result.stored)).toStrictEqual(
        Option.some(result.folder.id)
      );
    })
  );

  it.effect('FD-MOVE-1 takes a feed out to the top level', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const feed = feedIn(folder.id);

          yield* storeFeed(feed);
          yield* moveFeed(alice, feed.id, Option.none());

          return { feed, stored: yield* findFeed(alice, feed.id) };
        })
      );

      expect(Option.isNone(folderOf(result.stored))).toBe(true);
    })
  );
});

describe('moveFeed between folders', () => {
  it.effect('FD-MOVE-1 moves a feed between two folders', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const from = yield* storedFolder(alice);
          const to = yield* storedFolder(alice);
          const feed = feedIn(from.id);

          yield* storeFeed(feed);
          yield* moveFeed(alice, feed.id, Option.some(to.id));

          return { to, stored: yield* findFeed(alice, feed.id) };
        })
      );

      expect(folderOf(result.stored)).toStrictEqual(Option.some(result.to.id));
    })
  );

  it.effect('FD-MOVE-1 moving to the current folder changes nothing', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const feed = feedIn(folder.id);

          yield* storeFeed(feed);
          yield* moveFeed(alice, feed.id, Option.some(folder.id));

          return { feed, stored: yield* findFeed(alice, feed.id) };
        })
      );

      expect(result.stored).toStrictEqual(Option.some(result.feed));
    })
  );
});

describe('moveFeed items', () => {
  it.effect("FD-MOVE-2 keeps the feed's items and title", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const feed = yield* storedFeed(alice);

          yield* storeItems(alice, [
            makeUniqueFeedItem({ ownerId: alice, feedId: feed.id, read: true }),
            makeUniqueFeedItem({ ownerId: alice, feedId: feed.id }),
          ]);

          const before = yield* storedItems(alice, feed.id);

          yield* moveFeed(alice, feed.id, Option.some(folder.id));

          return {
            feed,
            before,
            after: yield* storedItems(alice, feed.id),
            stored: yield* findFeed(alice, feed.id),
          };
        })
      );
      const stored = Option.getOrThrow(result.stored);

      expect(result.after).toStrictEqual(result.before);
      expect(stored.title).toBe(result.feed.title);
      expect(stored.updatedAt).toStrictEqual(result.feed.updatedAt);
    })
  );
});

describe('moveFeed folder scope', () => {
  it.effect('FD-MOVE-4 the folder scope follows the move at once', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const from = yield* storedFolder(alice);
          const to = yield* storedFolder(alice);
          const feed = feedIn(from.id);
          const item = makeUniqueFeedItem({
            ownerId: alice,
            feedId: feed.id,
          });

          yield* storeFeed(feed);
          yield* storeItems(alice, [item]);
          yield* moveFeed(alice, feed.id, Option.some(to.id));

          return {
            url: item.url.href,
            moved: yield* itemInFolder(to.id),
            left: yield* itemInFolder(from.id),
          };
        })
      );

      expect(urlsOf(result.moved.items)).toEqual([result.url]);
      expect(result.left.items).toHaveLength(0);
    })
  );
});

describe('moveFeed unknown folders', () => {
  it.effect('FD-MOVE-3 an unknown folder fails and moves nothing', () =>
    Effect.gen(function* () {
      const unknown = makeFolder({ ownerId: alice }).id;
      const result = yield* run(
        Effect.gen(function* () {
          const feed = yield* storedFeed(alice);
          const error = yield* moveFeed(
            alice,
            feed.id,
            Option.some(unknown)
          ).pipe(Effect.flip);

          return { error, stored: yield* findFeed(alice, feed.id) };
        })
      );

      expect(result.error).toStrictEqual(new FolderNotFound({ id: unknown }));
      expect(Option.isNone(folderOf(result.stored))).toBe(true);
    })
  );
});

describe('moveFeed foreign folders', () => {
  it.effect("FD-MOVE-3 another owner's folder fails and moves nothing", () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const mine = yield* storedFolder(alice);
          const theirs = yield* storedFolder(bob);
          const feed = feedIn(mine.id);

          yield* storeFeed(feed);
          const error = yield* moveFeed(
            alice,
            feed.id,
            Option.some(theirs.id)
          ).pipe(Effect.flip);

          return {
            mine,
            theirs,
            error,
            stored: yield* findFeed(alice, feed.id),
          };
        })
      );

      expect(result.error).toStrictEqual(
        new FolderNotFound({ id: result.theirs.id })
      );
      expect(folderOf(result.stored)).toStrictEqual(
        Option.some(result.mine.id)
      );
    })
  );
});

describe('moveFeed unknown feeds', () => {
  it.effect('FD-OWN-2 an unknown feed succeeds without change', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const unknown = makeUniqueFeed({ ownerId: alice }).id;
          const intoFolder = yield* Effect.result(
            moveFeed(alice, unknown, Option.some(folder.id))
          );
          const topLevel = yield* Effect.result(
            moveFeed(alice, unknown, Option.none())
          );

          return {
            folder,
            intoFolder,
            topLevel,
            items: yield* itemInFolder(folder.id),
          };
        })
      );

      expect(Result.isSuccess(result.intoFolder)).toBe(true);
      expect(Result.isSuccess(result.topLevel)).toBe(true);
      expect(result.items.items).toHaveLength(0);
    })
  );
});
