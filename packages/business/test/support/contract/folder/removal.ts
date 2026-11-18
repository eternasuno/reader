import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { FeedRepositoryError } from '../../../../src/error/feed';
import type { FolderRepositoryError } from '../../../../src/error/folder';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  feedItemQuery,
  folderFeedRow,
  itemRow,
  makeUniqueFolder,
  storedFeed,
  storedFolder,
  storedFolderFeed,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const cascadeCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-FOLDER-7 removes the folder with its feeds and their items',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const folders = yield* FolderRepository;
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const fed = yield* storedFolderFeed(folder.id);
        const row = itemRow(fed.id);
        yield* items.create(alice, [row]);

        yield* folders.remove(alice, [folder.id]);

        expect(Option.isNone(yield* folders.find(alice, folder.id))).toBe(true);
        expect(Option.isNone(yield* feeds.find(alice, fed.id))).toBe(true);
        expect(Option.isNone(yield* items.find(alice, row.id))).toBe(true);
        expect(yield* items.listByFeed(alice, fed.id, feedItemQuery())).toEqual(
          []
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const keptRowsCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-FOLDER-7 keeps other folders, top-level feeds and their items',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const folders = yield* FolderRepository;
        const items = yield* FeedItemRepository;
        const removedFolder = yield* storedFolder();
        const keptFolder = yield* storedFolder();
        const removedFeed = yield* storedFolderFeed(removedFolder.id);
        const keptFeed = yield* storedFolderFeed(keptFolder.id);
        const topLevel = yield* storedFeed();
        const keptRow = itemRow(keptFeed.id);
        const topRow = itemRow(topLevel.id);
        yield* items.create(alice, [itemRow(removedFeed.id), keptRow, topRow]);

        yield* folders.remove(alice, [removedFolder.id]);

        expect(Option.isSome(yield* folders.find(alice, keptFolder.id))).toBe(
          true
        );
        expect(Option.isSome(yield* feeds.find(alice, topLevel.id))).toBe(true);
        expect(Option.isSome(yield* items.find(alice, keptRow.id))).toBe(true);
        expect(Option.isSome(yield* items.find(alice, topRow.id))).toBe(true);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const ignoreCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-FOLDER-7 ignores foreign and unknown ids', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folders = yield* FolderRepository;
      const items = yield* FeedItemRepository;
      const foreign = yield* storedFolder(bob);
      const theirFeed = yield* storedFolderFeed(foreign.id, bob);
      const theirs = itemRow(theirFeed.id, { ownerId: bob });
      yield* items.create(bob, [theirs]);

      yield* folders.remove(alice, [foreign.id, makeUniqueFolder().id]);

      expect(Option.getOrThrow(yield* folders.find(bob, foreign.id))).toEqual(
        foreign
      );
      expect(Option.isSome(yield* feeds.find(bob, theirFeed.id))).toBe(true);
      expect(Option.isSome(yield* items.find(bob, theirs.id))).toBe(true);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('CM-PORT-5 an empty list and a second removal change nothing', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = yield* storedFolder();
      const kept = yield* storedFolder();

      yield* folders.remove(alice, []);
      expect(yield* folders.list(alice)).toHaveLength(2);

      yield* folders.remove(alice, [folder.id]);
      yield* folders.remove(alice, [folder.id]);

      expect(yield* folders.list(alice)).toEqual([kept]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const moveRaceOnce = (): Effect.Effect<
  void,
  FeedRepositoryError | FolderRepositoryError,
  FeedRepository | FolderRepository
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const folders = yield* FolderRepository;
    const folder = yield* storedFolder();
    const feed = yield* storedFeed();

    yield* Effect.all(
      [
        feeds.moveToFolder(alice, feed.id, Option.some(folder.id)),
        folders.remove(alice, [folder.id]),
      ],
      { concurrency: 'unbounded' }
    );

    const stored = yield* feeds.find(alice, feed.id);

    expect(Option.isNone(yield* folders.find(alice, folder.id))).toBe(true);

    if (Option.isSome(stored)) {
      expect(Option.isNone(stored.value.folderId)).toBe(true);
    }
  });

const createRaceOnce = (): Effect.Effect<
  void,
  FeedRepositoryError | FolderRepositoryError,
  FeedRepository | FolderRepository
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const folders = yield* FolderRepository;
    const folder = yield* storedFolder();
    const feed = folderFeedRow(folder.id);

    yield* Effect.all(
      [feeds.create(alice, [feed]), folders.remove(alice, [folder.id])],
      {
        concurrency: 'unbounded',
      }
    );

    expect(Option.isNone(yield* folders.find(alice, folder.id))).toBe(true);
    expect(
      (yield* feeds.list(alice)).filter((row) =>
        Option.exists(row.folderId, (id) => id === folder.id)
      )
    ).toEqual([]);
  });

const raceCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-MOVE-3 never keeps a feed in a folder removed during a move',
    () =>
      Effect.forEach([1, 2, 3, 4], moveRaceOnce, { discard: true }).pipe(
        Effect.provide(makeLayer())
      )
  );

  it.effect('FD-FOLDER-6 never keeps a feed created in a removed folder', () =>
    Effect.forEach([1, 2, 3, 4], createRaceOnce, { discard: true }).pipe(
      Effect.provide(makeLayer())
    )
  );
};

export const removalCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('cascade to feeds and items', () => {
    cascadeCase(makeLayer);
    keptRowsCase(makeLayer);
  });
  describe('unknown and foreign ids', ignoreCases(makeLayer));
  describe('concurrent writes', raceCases(makeLayer));
};
