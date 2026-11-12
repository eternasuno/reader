import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import {
  alice,
  bob,
  makeUniqueFeedItem,
  storedFeed,
  storedFolder,
} from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';
import { storedFolderFeed } from './feed-store-row';

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
      yield* feeds.update(alice, [moved.id], { folderId: Option.none() });

      yield* items.updateByFolders(alice, [folder.id], { read: true });

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
  it.effect('changes nothing for the folder of another owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const bobFolder = yield* storedFolder(bob);
      const bobFeed = yield* storedFolderFeed(bobFolder.id, bob);
      const theirs = makeUniqueFeedItem({ ownerId: bob, feedId: bobFeed.id });
      const feed = yield* storedFeed();
      const mine = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [mine]);
      yield* items.create(bob, [theirs]);

      yield* items.updateByFolders(alice, [bobFolder.id], { read: true });

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

      yield* items.updateByFolders(alice, [], { read: true });

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
