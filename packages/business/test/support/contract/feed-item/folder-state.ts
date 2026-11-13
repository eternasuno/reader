import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  makeUniqueFeedItem,
  makeUniqueFolder,
  storedFeed,
  storedFolder,
  storedFolderFeed,
} from '../../fixtures';
import type { FeedStoreLayer } from '../feed';

const markFolderItemsCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('marks the items of the feeds in the folder only', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const otherFolder = yield* storedFolder();
      const inside = yield* storedFolderFeed(folder.id);
      const moved = yield* storedFolderFeed(folder.id);
      const topLevel = yield* storedFeed();
      const elsewhere = yield* storedFolderFeed(otherFolder.id);
      const mine = makeUniqueFeedItem({ feedId: inside.id });
      const movedOut = makeUniqueFeedItem({ feedId: moved.id });
      const top = makeUniqueFeedItem({ feedId: topLevel.id });
      const other = makeUniqueFeedItem({ feedId: elsewhere.id });
      yield* items.create(alice, [mine, movedOut, top, other]);
      yield* feeds.moveToFolder(alice, moved.id, Option.none());

      yield* items.markReadByFolders(alice, [folder.id]);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
        true
      );
      expect(
        Option.getOrThrow(yield* items.find(alice, movedOut.id)).read
      ).toBe(false);
      expect(Option.getOrThrow(yield* items.find(alice, top.id)).read).toBe(
        false
      );
      expect(Option.getOrThrow(yield* items.find(alice, other.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

const markForeignFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-READ-5 changes nothing for a foreign or unknown folder', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const bobFolder = yield* storedFolder(bob);
      const bobFeed = yield* storedFolderFeed(bobFolder.id, bob);
      const theirs = makeUniqueFeedItem({ ownerId: bob, feedId: bobFeed.id });
      const feed = yield* storedFeed();
      const mine = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [mine]);
      yield* items.create(bob, [theirs]);

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
    }).pipe(Effect.provide(layer))
  );
};

const markEmptyFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('changes nothing for an empty folder id list', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const fed = yield* storedFolderFeed(folder.id);
      const mine = makeUniqueFeedItem({ feedId: fed.id });
      yield* items.create(alice, [mine]);

      yield* items.markReadByFolders(alice, []);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

export const markFolderCases = (layer: FeedStoreLayer) => (): void => {
  describe('scope', markFolderItemsCases(layer));
  describe('another owner', markForeignFolderCases(layer));
  describe('empty ids', markEmptyFolderCases(layer));
};
