import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedItemQuery,
  idsOf,
  itemRow,
  makeUniqueFeed,
  makeUniqueFolder,
  storedFeed,
  storedFolder,
  storedFolderFeed,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';
import { type ListScopeSetup, listCases } from './list';

const query = feedItemQuery();

export const allScope: ListScopeSetup = (makeRows) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const feed = makeUniqueFeed({ ownerId: alice });
    const rows = makeRows(feed.id);
    yield* feeds.create(alice, [feed]);
    yield* items.create(alice, rows);

    return {
      feedId: feed.id,
      rows,
      list: (asked) => items.listAll(alice, asked),
    };
  });

export const byFeedScope: ListScopeSetup = (makeRows) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const feed = yield* storedFeed();
    const rows = makeRows(feed.id);
    yield* items.create(alice, rows);

    return {
      feedId: feed.id,
      rows,
      list: (asked) => items.listByFeed(alice, feed.id, asked),
    };
  });

export const byFolderScope: ListScopeSetup = (makeRows) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const folder = yield* storedFolder();
    const feed = yield* storedFolderFeed(folder.id);
    const rows = makeRows(feed.id);
    yield* items.create(alice, rows);

    return {
      feedId: feed.id,
      rows,
      list: (asked) => items.listByFolder(alice, folder.id, asked),
    };
  });

const allScopeCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-LIST-1 lists the items of the feeds in folders too', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const inFolder = yield* storedFolderFeed(folder.id);
      const topLevel = yield* storedFeed();
      const rows = [itemRow(inFolder.id), itemRow(topLevel.id)];
      yield* items.create(alice, rows);

      expect(idsOf(yield* items.listAll(alice, query))).toEqual(
        idsOf(rows).reverse()
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('CM-OWN-2 lists only the items of the owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const mine = yield* storedFeed();
      const theirs = yield* storedFeed(bob);
      const myRow = itemRow(mine.id);
      yield* items.create(alice, [myRow]);
      yield* items.create(bob, [itemRow(theirs.id, { ownerId: bob })]);

      expect(idsOf(yield* items.listAll(alice, query))).toEqual([myRow.id]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const feedScopeCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-LIST-2 excludes the items of other feeds', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const other = yield* storedFeed();
      const mine = itemRow(feed.id);
      yield* items.create(alice, [mine, itemRow(other.id)]);

      expect(idsOf(yield* items.listByFeed(alice, feed.id, query))).toEqual([
        mine.id,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'FD-LIST-2 gives an empty page for an unknown or foreign feed',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const theirFeed = yield* storedFeed(bob);
        const theirRow = itemRow(theirFeed.id, { ownerId: bob });
        yield* items.create(alice, [itemRow(feed.id)]);
        yield* items.create(bob, [theirRow]);

        expect(
          idsOf(yield* items.listByFeed(bob, theirFeed.id, query))
        ).toEqual([theirRow.id]);
        expect(
          yield* items.listByFeed(alice, makeUniqueFeed().id, query)
        ).toEqual([]);
        expect(yield* items.listByFeed(alice, theirFeed.id, query)).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const folderMergeCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-LIST-6 merges the feeds of the folder newest first', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const first = yield* storedFolderFeed(folder.id);
      const second = yield* storedFolderFeed(folder.id);
      const rows = [itemRow(first.id), itemRow(second.id), itemRow(first.id)];
      yield* items.create(alice, rows);

      expect(idsOf(yield* items.listByFolder(alice, folder.id, query))).toEqual(
        idsOf(rows).reverse()
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const folderExclusionCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-LIST-7 excludes top-level feeds and feeds of other folders',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const otherFolder = yield* storedFolder();
        const inside = yield* storedFolderFeed(folder.id);
        const topLevel = yield* storedFeed();
        const elsewhere = yield* storedFolderFeed(otherFolder.id);
        const mine = itemRow(inside.id);
        yield* items.create(alice, [
          mine,
          itemRow(topLevel.id),
          itemRow(elsewhere.id),
        ]);

        expect(
          idsOf(yield* items.listByFolder(alice, folder.id, query))
        ).toEqual([mine.id]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const emptyFolderCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-LIST-7 gives an empty page for an unknown, foreign or empty folder',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFolder = yield* storedFolder(bob);
        const bobFeed = yield* storedFolderFeed(bobFolder.id, bob);
        const empty = yield* storedFolder();
        yield* items.create(alice, [itemRow(feed.id)]);
        yield* items.create(bob, [itemRow(bobFeed.id, { ownerId: bob })]);

        expect(
          yield* items.listByFolder(alice, makeUniqueFolder().id, query)
        ).toEqual([]);
        expect(yield* items.listByFolder(alice, bobFolder.id, query)).toEqual(
          []
        );
        expect(yield* items.listByFolder(alice, empty.id, query)).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const folderMembershipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-LIST-6 lists the feeds that are in the folder when it lists',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const feed = yield* storedFolderFeed(folder.id);
        const row = itemRow(feed.id);
        yield* items.create(alice, [row]);

        expect(
          idsOf(yield* items.listByFolder(alice, folder.id, query))
        ).toEqual([row.id]);

        yield* feeds.moveToFolder(alice, feed.id, Option.none());

        expect(yield* items.listByFolder(alice, folder.id, query)).toEqual([]);

        yield* feeds.moveToFolder(alice, feed.id, Option.some(folder.id));

        expect(
          idsOf(yield* items.listByFolder(alice, folder.id, query))
        ).toEqual([row.id]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const listAllCases = (makeLayer: FeedStoreFactory): void => {
  describe('listAll', () => {
    listCases(makeLayer, allScope);
    describe('scope', allScopeCases(makeLayer));
  });
};

export const listByFeedCases = (makeLayer: FeedStoreFactory): void => {
  describe('listByFeed', () => {
    listCases(makeLayer, byFeedScope);
    describe('scope', feedScopeCases(makeLayer));
  });
};

export const listByFolderCases = (makeLayer: FeedStoreFactory): void => {
  describe('listByFolder', () => {
    listCases(makeLayer, byFolderScope);
    describe('scope', () => {
      folderMergeCase(makeLayer);
      folderExclusionCase(makeLayer);
      emptyFolderCase(makeLayer);
    });
    describe('membership', folderMembershipCases(makeLayer));
  });
};
