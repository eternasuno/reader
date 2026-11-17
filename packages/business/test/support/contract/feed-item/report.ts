import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import {
  alice,
  bob,
  feedItemQuery,
  idsOf,
  itemRow,
  makeUniqueFeed,
  storedFeed,
  unreadCountFor,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const unreadCountCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-COUNT-1 counts the unread items per feed of the owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const quiet = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      yield* items.create(alice, [
        itemRow(feed.id),
        itemRow(feed.id),
        itemRow(feed.id, { read: true }),
        itemRow(quiet.id),
      ]);
      yield* items.create(bob, [itemRow(bobFeed.id, { ownerId: bob })]);

      const counts = yield* items.unreadCounts(alice);

      expect(unreadCountFor(counts, feed.id)).toBe(2);
      expect(unreadCountFor(counts, quiet.id)).toBe(1);
      expect(counts.some((count) => count.feedId === bobFeed.id)).toBe(false);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-COUNT-1 counts a feed with no unread item as zero', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      yield* items.create(alice, [itemRow(feed.id, { read: true })]);

      const counts = yield* items.unreadCounts(alice);

      expect(unreadCountFor(counts, feed.id)).toBe(0);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-COUNT-1 stops counting the items a feed marks read', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      yield* items.create(alice, [itemRow(feed.id), itemRow(feed.id)]);

      yield* items.markReadByFeeds(alice, [feed.id]);

      expect(unreadCountFor(yield* items.unreadCounts(alice), feed.id)).toBe(0);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const inventoryCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-SEL-8 returns the id and url of each item in list order', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const other = yield* storedFeed();
      const first = itemRow(feed.id);
      const second = itemRow(feed.id);
      yield* items.create(alice, [first, second]);
      yield* items.create(alice, [itemRow(other.id)]);

      expect(yield* items.inventory(alice, feed.id)).toEqual([
        { id: second.id, url: second.url },
        { id: first.id, url: first.url },
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'FD-SEL-8 gives an empty inventory for a foreign or unknown feed',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const bobFeed = yield* storedFeed(bob);
        yield* items.create(bob, [itemRow(bobFeed.id, { ownerId: bob })]);

        expect(yield* items.inventory(alice, bobFeed.id)).toEqual([]);
        expect(yield* items.inventory(alice, makeUniqueFeed().id)).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const removeCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-SYNC removes the owner items among the ids and ignores others',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const removed = itemRow(feed.id);
        const kept = itemRow(feed.id);
        const foreign = itemRow(bobFeed.id, { ownerId: bob });
        yield* items.create(alice, [removed, kept]);
        yield* items.create(bob, [foreign]);

        yield* items.remove(alice, [removed.id, foreign.id]);
        yield* items.remove(alice, [removed.id]);

        expect(Option.isNone(yield* items.find(alice, removed.id))).toBe(true);
        expect(Option.isSome(yield* items.find(alice, kept.id))).toBe(true);
        expect(Option.isSome(yield* items.find(bob, foreign.id))).toBe(true);
        expect(idsOf(yield* items.listAll(alice, feedItemQuery()))).toEqual([
          kept.id,
        ]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const reportCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('unread counts', unreadCountCases(makeLayer));
  describe('inventory', inventoryCases(makeLayer));
  describe('remove', removeCases(makeLayer));
};
