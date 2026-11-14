import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Result } from 'effect';
import type { Feed } from '../../../src/entity/feed/feed';
import type { FolderId } from '../../../src/entity/feed/folder';
import { FolderNotFound } from '../../../src/usecase/feed/errors';
import { listFolderItems } from '../../../src/usecase/feed/list-items';
import { moveFeed } from '../../../src/usecase/feed/move-feed';
import {
  alice,
  makeFolder,
  makeUniqueFeed,
  storedFeed,
  storedFolder,
} from '../../support/fixtures';
import { findFeed, run, storeFeed } from '../../support/usecase/feed';

const feedIn = (folderId: FolderId): Feed =>
  makeUniqueFeed({ folderId: Option.some(folderId) });

const itemInFolder = (folderId: FolderId): ReturnType<typeof listFolderItems> =>
  listFolderItems(alice, folderId, {
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
