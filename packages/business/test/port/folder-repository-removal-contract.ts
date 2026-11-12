import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../src/port/feed-repository';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../src/port/folder-repository';
import {
  alice,
  bob,
  makeUniqueFeedItem,
  makeUniqueFolder,
  storedFeed,
  storedFolder,
} from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';
import { folderFeedRow, storedFolderFeed } from './feed-store-row';

const query = { limit: 10, unreadOnly: false };

const cascadeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('removes the folder with its feeds and their items', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folders = yield* FolderRepository;
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const fed = yield* storedFolderFeed(folder.id);
      const row = makeUniqueFeedItem({ feedId: fed.id });
      yield* items.create(alice, [row]);

      yield* folders.remove(alice, [folder.id]);

      expect(Option.isNone(yield* folders.find(alice, folder.id))).toBe(true);
      expect(Option.isNone(yield* feeds.find(alice, fed.id))).toBe(true);
      expect(Option.isNone(yield* items.find(alice, row.id))).toBe(true);
      expect(yield* items.listByFeed(alice, fed.id, query)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const keptCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('keeps other folders, top-level feeds and their items', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folders = yield* FolderRepository;
      const items = yield* FeedItemRepository;
      const removedFolder = yield* storedFolder();
      const keptFolder = yield* storedFolder();
      const removedFeed = yield* storedFolderFeed(removedFolder.id);
      const keptFeed = yield* storedFolderFeed(keptFolder.id);
      const topLevel = yield* storedFeed();
      const keptRow = makeUniqueFeedItem({ feedId: keptFeed.id });
      const topRow = makeUniqueFeedItem({ feedId: topLevel.id });
      yield* items.create(alice, [
        makeUniqueFeedItem({ feedId: removedFeed.id }),
        keptRow,
        topRow,
      ]);

      yield* folders.remove(alice, [removedFolder.id]);

      expect(Option.isSome(yield* folders.find(alice, keptFolder.id))).toBe(
        true
      );
      expect(Option.isSome(yield* feeds.find(alice, topLevel.id))).toBe(true);
      expect(Option.isSome(yield* items.find(alice, keptRow.id))).toBe(true);
      expect(Option.isSome(yield* items.find(alice, topRow.id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const ignoreCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('ignores foreign and unknown ids', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const folders = yield* FolderRepository;
      const items = yield* FeedItemRepository;
      const foreign = yield* storedFolder(bob);
      const theirFeed = yield* storedFolderFeed(foreign.id, bob);
      const theirs = makeUniqueFeedItem({ ownerId: bob, feedId: theirFeed.id });
      yield* items.create(bob, [theirs]);

      yield* folders.remove(alice, [foreign.id, makeUniqueFolder().id]);

      expect(Option.getOrThrow(yield* folders.find(bob, foreign.id))).toEqual(
        foreign
      );
      expect(Option.isSome(yield* feeds.find(bob, theirFeed.id))).toBe(true);
      expect(Option.isSome(yield* items.find(bob, theirs.id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );

  it.effect('is idempotent', () =>
    Effect.gen(function* () {
      const folders = yield* FolderRepository;
      const folder = yield* storedFolder();
      yield* folders.remove(alice, [folder.id]);
      yield* folders.remove(alice, [folder.id]);

      expect(yield* folders.list(alice)).toEqual([]);
    }).pipe(Effect.provide(layer))
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
        feeds.update(alice, [feed.id], { folderId: Option.some(folder.id) }),
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

    const pointing = yield* feeds.list(alice);

    expect(Option.isNone(yield* folders.find(alice, folder.id))).toBe(true);
    expect(
      pointing.filter((row) =>
        Option.exists(row.folderId, (id) => id === folder.id)
      )
    ).toEqual([]);
  });

const raceCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('never keeps a feed in a folder removed during a move', () =>
    Effect.forEach([1, 2, 3, 4], moveRaceOnce, { discard: true }).pipe(
      Effect.provide(layer)
    )
  );

  it.effect('never keeps a feed created in a folder removed at once', () =>
    Effect.forEach([1, 2, 3, 4], createRaceOnce, { discard: true }).pipe(
      Effect.provide(layer)
    )
  );
};

export const removalCases = (layer: FeedStoreLayer) => (): void => {
  describe('cascade to feeds and items', cascadeCases(layer));
  describe('kept rows', keptCases(layer));
  describe('unknown and foreign ids', ignoreCases(layer));
  describe('concurrent writes', raceCases(layer));
};
