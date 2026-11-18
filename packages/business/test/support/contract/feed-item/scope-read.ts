import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  itemRow,
  makeUniqueFeed,
  makeUniqueFolder,
  storedFeed,
  storedFolder,
  storedFolderFeed,
  unreadCountFor,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const markFeedCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-READ-2 marks only the items of the owner feeds among the ids',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const marked = yield* storedFeed();
        const untouched = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const mine = itemRow(marked.id);
        const other = itemRow(untouched.id);
        const foreign = itemRow(bobFeed.id, { ownerId: bob });
        yield* items.create(alice, [mine, other]);
        yield* items.create(bob, [foreign]);

        yield* items.markReadByFeeds(alice, [marked.id, bobFeed.id]);

        expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
          true
        );
        expect(Option.getOrThrow(yield* items.find(alice, other.id)).read).toBe(
          false
        );
        expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
          false
        );
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-READ-2 ignores unknown ids and an empty feed id list', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const row = itemRow(feed.id);
      yield* items.create(alice, [row]);

      yield* items.markReadByFeeds(alice, []);
      yield* items.markReadByFeeds(alice, [makeUniqueFeed().id]);

      expect(Option.getOrThrow(yield* items.find(alice, row.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const markFolderZoneCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-READ-5 marks the items of the feeds in the folder only', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const otherFolder = yield* storedFolder();
      const inside = yield* storedFolderFeed(folder.id);
      const topLevel = yield* storedFeed();
      const elsewhere = yield* storedFolderFeed(otherFolder.id);
      const mine = itemRow(inside.id);
      const top = itemRow(topLevel.id);
      const other = itemRow(elsewhere.id);
      yield* items.create(alice, [mine, top, other]);

      yield* items.markReadByFolders(alice, [folder.id]);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
        true
      );
      expect(Option.getOrThrow(yield* items.find(alice, top.id)).read).toBe(
        false
      );
      expect(Option.getOrThrow(yield* items.find(alice, other.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const markFolderMovedOutCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-READ-5 leaves a feed that left the folder unchanged', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const moved = yield* storedFolderFeed(folder.id);
      const row = itemRow(moved.id);
      yield* items.create(alice, [row]);
      yield* feeds.moveToFolder(alice, moved.id, Option.none());

      yield* items.markReadByFolders(alice, [folder.id]);

      expect(Option.getOrThrow(yield* items.find(alice, row.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const markFolderIgnoredCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-READ-5 ignores a foreign folder, an unknown folder and an empty list',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const bobFolder = yield* storedFolder(bob);
        const bobFeed = yield* storedFolderFeed(bobFolder.id, bob);
        const theirs = itemRow(bobFeed.id, { ownerId: bob });
        const feed = yield* storedFeed();
        const mine = itemRow(feed.id);
        yield* items.create(alice, [mine]);
        yield* items.create(bob, [theirs]);

        yield* items.markReadByFolders(alice, []);
        yield* items.markReadByFolders(alice, [
          bobFolder.id,
          makeUniqueFolder().id,
        ]);

        expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
          false
        );
        expect(Option.getOrThrow(yield* items.find(bob, theirs.id)).read).toBe(
          false
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const markAllCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-READ marks every item of the owner and no other owner item',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const fed = yield* storedFolderFeed(folder.id);
        const topLevel = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const first = itemRow(fed.id);
        const second = itemRow(topLevel.id);
        const foreign = itemRow(bobFeed.id, { ownerId: bob });
        yield* items.create(alice, [first, second]);
        yield* items.create(bob, [foreign]);

        yield* items.markAllRead(alice);

        expect(Option.getOrThrow(yield* items.find(alice, first.id)).read).toBe(
          true
        );
        expect(
          Option.getOrThrow(yield* items.find(alice, second.id)).read
        ).toBe(true);
        expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
          false
        );
        const counts = yield* items.unreadCounts(alice);

        expect(unreadCountFor(counts, first.feedId)).toBe(0);
        expect(unreadCountFor(counts, second.feedId)).toBe(0);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const scopeReadCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('by feed', markFeedCases(makeLayer));
  describe('by folder', () => {
    markFolderZoneCase(makeLayer);
    markFolderMovedOutCase(makeLayer);
    markFolderIgnoredCase(makeLayer);
  });
  describe('all', markAllCases(makeLayer));
};
