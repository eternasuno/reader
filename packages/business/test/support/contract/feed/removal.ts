import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { FeedRepositoryError } from '../../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../../src/error/feed-item';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedItemQuery,
  feedRow,
  itemRow,
  makeFeed,
  storedFeed,
  uniqueUrl,
  unreadCountFor,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const cascadeCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-UNSUB-1 removes the feeds with their items', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const items = yield* FeedItemRepository;
      const removed = feedRow();
      const kept = feedRow();
      yield* feeds.create(alice, [removed, kept]);
      yield* items.create(alice, [itemRow(removed.id), itemRow(kept.id)]);

      yield* feeds.remove(alice, [removed.id]);

      expect(Option.isNone(yield* feeds.find(alice, removed.id))).toBe(true);
      expect(
        yield* items.listByFeed(alice, removed.id, feedItemQuery(), 'newest')
      ).toEqual([]);
      expect(yield* items.inventory(alice, removed.id)).toEqual([]);
      const counts = yield* items.unreadCounts(alice);

      expect(unreadCountFor(counts, kept.id)).toBe(1);
      expect(counts.some((count) => count.feedId === removed.id)).toBe(false);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const ignoreCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-UNSUB-2 ignores unknown and foreign ids', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);
      const mine = feedRow();
      yield* feeds.create(bob, [foreign]);
      yield* feeds.create(alice, [mine]);

      yield* feeds.remove(alice, [foreign.id, makeFeed().id]);

      expect(Option.getOrThrow(yield* feeds.find(bob, foreign.id))).toEqual(
        foreign
      );
      expect(yield* feeds.list(alice)).toEqual([mine]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('CM-PORT-5 an empty list and a second removal change nothing', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const kept = feedRow();
      const removed = feedRow();
      yield* feeds.create(alice, [kept, removed]);

      yield* feeds.remove(alice, []);
      expect(yield* feeds.list(alice)).toHaveLength(2);

      yield* feeds.remove(alice, [removed.id]);
      yield* feeds.remove(alice, [removed.id]);

      expect(yield* feeds.list(alice)).toEqual([kept]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const raceOnce = (): Effect.Effect<
  void,
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const feed = yield* storedFeed();
    const rows = [itemRow(feed.id), itemRow(feed.id)];

    yield* Effect.all(
      [items.create(alice, rows), feeds.remove(alice, [feed.id])],
      { concurrency: 'unbounded' }
    );

    expect(Option.isNone(yield* feeds.find(alice, feed.id))).toBe(true);
    expect(
      yield* items.listByFeed(alice, feed.id, feedItemQuery(), 'newest')
    ).toEqual([]);
    expect(yield* items.inventory(alice, feed.id)).toEqual([]);
    expect(
      (yield* items.unreadCounts(alice)).filter(
        (count) => count.feedId === feed.id
      )
    ).toEqual([]);

    for (const row of rows) {
      expect(Option.isNone(yield* items.find(alice, row.id))).toBe(true);
    }
  });

const raceCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'FD-SYNC-5 leaves no items when the feed is removed during a create',
    () =>
      Effect.forEach([1, 2, 3, 4], raceOnce, { discard: true }).pipe(
        Effect.provide(makeLayer())
      )
  );
};

const resubscribeCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-UNSUB-5 subscribing again gives a new feed with a new id', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const first = makeFeed({ ownerId: alice, url });
      yield* feeds.create(alice, [first]);
      yield* feeds.remove(alice, [first.id]);
      const second = makeFeed({ ownerId: alice, url });

      expect(yield* feeds.create(alice, [second])).toEqual([second.id]);
      expect(yield* feeds.list(alice)).toEqual([second]);
      expect(second.id).not.toBe(first.id);
      expect(second.id > first.id).toBe(true);
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const removalCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('cascade to items', cascadeCases(makeLayer));
  describe('unknown and foreign ids', ignoreCases(makeLayer));
  describe('concurrent item create', raceCases(makeLayer));
  describe('resubscribe', resubscribeCases(makeLayer));
};
