import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { type Feed, FeedTitle } from '../../../src/entity/feed/feed';
import type { FolderId } from '../../../src/entity/folder/folder';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../src/port/feed-repository';
import { FolderRepository } from '../../../src/port/folder-repository';
import { moveFeed } from '../../../src/usecase/folder/move-feed';
import type { FeedOverrides } from '../../support/fixtures';
import {
  alice,
  bob,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueFolder,
  updatedTime,
} from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';
import { storedItems } from '../feed-item/harness';

type Env = FeedRepository | FolderRepository | FeedItemRepository;

const run = <A, E>(effect: Effect.Effect<A, E, Env>): Effect.Effect<A, E> =>
  Effect.provide(effect, MemoryFeedStoreLive);

const folderOf = (feed: Feed): Option.Option<FolderId> => feed.folderId;

const storeFeed = (overrides: FeedOverrides = {}) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ ownerId: alice, ...overrides });

    yield* feeds.create(alice, [feed]);

    return feed;
  });

describe('moveFeed', () => {
  it.effect('FD-MOVE puts a top-level feed into a folder', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const feeds = yield* FeedRepository;
          const folder = makeUniqueFolder({ ownerId: alice });

          yield* folders.create(alice, [folder]);

          const feed = yield* storeFeed();

          yield* moveFeed(alice, feed.id, Option.some(folder.id));

          return { folder, found: yield* feeds.find(alice, feed.id) };
        })
      );

      expect(folderOf(Option.getOrThrow(outcome.found))).toEqual(
        Option.some(outcome.folder.id)
      );
    })
  );
});

describe('moveFeed out of a folder', () => {
  it.effect('FD-MOVE none takes the feed out of its folder', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const feeds = yield* FeedRepository;
          const folder = makeUniqueFolder({ ownerId: alice });

          yield* folders.create(alice, [folder]);

          const feed = yield* storeFeed({ folderId: Option.some(folder.id) });

          yield* moveFeed(alice, feed.id, Option.none());

          return { found: yield* feeds.find(alice, feed.id) };
        })
      );

      expect(Option.isNone(folderOf(Option.getOrThrow(outcome.found)))).toBe(
        true
      );
    })
  );
});

describe('moveFeed to the same folder', () => {
  it.effect(
    'FD-MOVE-1 moving to the folder the feed is already in changes nothing',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const feeds = yield* FeedRepository;
            const folder = makeUniqueFolder({ ownerId: alice });

            yield* folders.create(alice, [folder]);

            const feed = yield* storeFeed({ folderId: Option.some(folder.id) });

            yield* moveFeed(alice, feed.id, Option.some(folder.id));

            return { folder, found: yield* feeds.find(alice, feed.id) };
          })
        );

        expect(folderOf(Option.getOrThrow(outcome.found))).toEqual(
          Option.some(outcome.folder.id)
        );
      })
  );
});

describe('moveFeed keeps the feed', () => {
  it.effect(
    'FD-MOVE-2 keeps the items, their read state, the title and the sync time',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const feeds = yield* FeedRepository;
            const items = yield* FeedItemRepository;
            const folder = makeUniqueFolder({ ownerId: alice });

            yield* folders.create(alice, [folder]);

            const feed = yield* storeFeed();

            yield* feeds.recordSync(
              alice,
              feed.id,
              FeedTitle.make('Go Blog'),
              updatedTime()
            );

            const item = makeUniqueFeedItem({
              ownerId: alice,
              feedId: feed.id,
              read: true,
            });

            yield* items.create(alice, [item]);
            yield* moveFeed(alice, feed.id, Option.some(folder.id));

            return {
              stored: item,
              found: yield* feeds.find(alice, feed.id),
              items: yield* storedItems(feed.id),
            };
          })
        );

        const feed = Option.getOrThrow(outcome.found);

        expect(feed.title).toBe('Go Blog');
        expect(Option.isSome(feed.updatedAt)).toBe(true);
        expect(outcome.items.map((item) => item.id)).toEqual([
          outcome.stored.id,
        ]);
        expect(outcome.items[0]?.read).toBe(true);
      })
  );
});

describe('moveFeed folder failures', () => {
  it.effect(
    'FD-MOVE-3 a folder of another owner fails FolderNotFound and moves nothing',
    () =>
      Effect.gen(function* () {
        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const feeds = yield* FeedRepository;
            const foreign = makeUniqueFolder({ ownerId: bob });

            yield* folders.create(bob, [foreign]);

            const feed = yield* storeFeed();

            const error = yield* moveFeed(
              alice,
              feed.id,
              Option.some(foreign.id)
            ).pipe(Effect.flip);

            return { error, found: yield* feeds.find(alice, feed.id) };
          })
        );

        expect(outcome.error._tag).toBe('FolderNotFound');
        expect(Option.isNone(folderOf(Option.getOrThrow(outcome.found)))).toBe(
          true
        );
      })
  );
});

describe('moveFeed unknown feeds', () => {
  it.effect('FD-OWN-2 a feed that does not exist succeeds without change', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });

      yield* run(moveFeed(alice, feed.id, Option.none()));
    })
  );
});

describe('moveFeed other owners', () => {
  it.effect('FD-FOLDER-6 a feed of another owner is not moved', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const feeds = yield* FeedRepository;
          const folder = makeUniqueFolder({ ownerId: alice });
          const theirs = makeUniqueFeed({ ownerId: bob });

          yield* folders.create(alice, [folder]);
          yield* feeds.create(bob, [theirs]);
          yield* moveFeed(alice, theirs.id, Option.some(folder.id));

          return { found: yield* feeds.find(bob, theirs.id) };
        })
      );

      expect(Option.isNone(folderOf(Option.getOrThrow(outcome.found)))).toBe(
        true
      );
    })
  );
});
