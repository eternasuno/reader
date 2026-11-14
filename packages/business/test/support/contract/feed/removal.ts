import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../../src/port/feed-item-repository';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedRow,
  makeFeed,
  makeUniqueFeedItem,
  storedFeed,
  uniqueUrl,
} from '../../fixtures';
import type { FeedStoreLayer } from '.';

const removeCascadeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('removes the feeds of the owner and their items', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const items = yield* FeedItemRepository;
      const removed = feedRow();
      const kept = feedRow();
      yield* feeds.create(alice, [removed, kept]);
      yield* items.create(alice, [
        makeUniqueFeedItem({ ownerId: alice, feedId: removed.id }),
        makeUniqueFeedItem({ ownerId: alice, feedId: kept.id }),
      ]);
      yield* feeds.remove(alice, [removed.id]);

      expect(Option.isNone(yield* feeds.find(alice, removed.id))).toBe(true);
      expect(
        yield* items.listByFeed(alice, removed.id, {
          unreadOnly: false,
          limit: 10,
        })
      ).toEqual([]);
      expect(yield* items.inventory(alice, removed.id)).toEqual([]);
      expect(
        yield* items.listByFeed(alice, kept.id, {
          unreadOnly: false,
          limit: 10,
        })
      ).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );
};

const removeIgnoreCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('ignores foreign and unknown ids', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);
      yield* feeds.create(bob, [foreign]);
      yield* feeds.remove(alice, [foreign.id, makeFeed().id]);

      expect(Option.getOrThrow(yield* feeds.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('is idempotent', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      yield* feeds.create(alice, [feed]);
      yield* feeds.remove(alice, [feed.id]);
      yield* feeds.remove(alice, [feed.id]);

      expect(yield* feeds.list(alice)).toEqual([]);
    }).pipe(Effect.provide(layer))
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
    const rows = [
      makeUniqueFeedItem({ feedId: feed.id }),
      makeUniqueFeedItem({ feedId: feed.id }),
    ];

    yield* Effect.all(
      [items.create(alice, rows), feeds.remove(alice, [feed.id])],
      { concurrency: 'unbounded' }
    );

    expect(Option.isNone(yield* feeds.find(alice, feed.id))).toBe(true);
    expect(
      yield* items.listByFeed(alice, feed.id, {
        unreadOnly: false,
        limit: 10,
      })
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

const removalRaceCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('leaves no items when the feed is removed during a create', () =>
    Effect.forEach([1, 2, 3, 4], raceOnce, { discard: true }).pipe(
      Effect.provide(layer)
    )
  );
};

const resubscribeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-UNSUB-5 subscribes again with a new feed and a new id', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const first = makeFeed({ ownerId: alice, url });
      yield* feeds.create(alice, [first]);
      yield* feeds.remove(alice, [first.id]);
      const second = makeFeed({ ownerId: alice, url });
      yield* feeds.create(alice, [second]);

      const listed = yield* feeds.list(alice);

      expect(listed).toEqual([second]);
      expect(second.id).not.toBe(first.id);
      expect(second.id > first.id).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

export const removalCases = (layer: FeedStoreLayer) => (): void => {
  describe('cascade to items', removeCascadeCases(layer));
  describe('unknown and foreign ids', removeIgnoreCases(layer));
  describe('concurrent item create', removalRaceCases(layer));
  describe('resubscribe', resubscribeCases(layer));
};
