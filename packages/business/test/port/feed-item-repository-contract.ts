import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import {
  alice,
  bob,
  idsOf,
  makeUniqueFeed,
  makeUniqueFeedItem,
  storedFeed,
} from '../support';
import {
  createResultCases,
  createSkipCases,
  createUniqueCases,
} from './feed-item-create-contract';
import {
  inventoryCases,
  markAllCases,
  markFeedCases,
  removeCases,
  unreadCountCases,
  updateCases,
} from './feed-item-state-contract';
import type { FeedStoreLayer } from './feed-repository-contract';

const findCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the owner item and reports a foreign one as missing', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const mine = makeUniqueFeedItem({ feedId: feed.id });
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      yield* items.create(alice, [mine]);
      yield* items.create(bob, [foreign]);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id))).toEqual(
        mine
      );
      expect(Option.isNone(yield* items.find(alice, foreign.id))).toBe(true);
      expect(
        Option.isNone(yield* items.find(alice, makeUniqueFeedItem().id))
      ).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const orderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('lists the owner items newest first at most limit', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });
      const third = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [first, second, third]);
      yield* items.create(bob, [
        makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob }),
      ]);

      const page = yield* items.list(alice, { limit: 2, unreadOnly: false });

      expect(idsOf(page)).toEqual([third.id, second.id]);
    }).pipe(Effect.provide(layer))
  );
};

const filterCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('applies the cursor and the feed filter', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const other = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });
      const only = makeUniqueFeedItem({ feedId: other.id });
      yield* items.create(alice, [first, second, only]);

      const after = yield* items.list(alice, {
        after: second.id,
        limit: 10,
        unreadOnly: false,
      });

      expect(idsOf(after)).toEqual([first.id]);
      expect(
        yield* items.list(alice, {
          feedId: other.id,
          limit: 10,
          unreadOnly: false,
        })
      ).toEqual([only]);
      expect(
        yield* items.list(alice, {
          feedId: bobFeed.id,
          limit: 10,
          unreadOnly: false,
        })
      ).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const unknownFeedCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns an empty page for an unknown feed id', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      yield* items.create(alice, [makeUniqueFeedItem({ feedId: feed.id })]);

      expect(
        yield* items.list(alice, {
          feedId: makeUniqueFeed().id,
          limit: 10,
          unreadOnly: false,
        })
      ).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const unreadCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns unread items only', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const read = makeUniqueFeedItem({ feedId: feed.id, read: true });
      const unread = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [read, unread]);

      const listed = yield* items.list(alice, { limit: 10, unreadOnly: true });

      expect(idsOf(listed)).toEqual([unread.id]);
    }).pipe(Effect.provide(layer))
  );
};

const deletedCursorCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('keeps paging after the cursor row was removed', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });
      const third = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [first, second, third]);
      yield* items.remove(alice, [second.id]);

      const afterRemoved = yield* items.list(alice, {
        after: second.id,
        limit: 10,
        unreadOnly: false,
      });

      expect(idsOf(afterRemoved)).toEqual([first.id]);
    }).pipe(Effect.provide(layer))
  );
};

const everyRowCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('pages through every row without repeating or skipping', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });
      const third = makeUniqueFeedItem({ feedId: feed.id });
      const fourth = makeUniqueFeedItem({ feedId: feed.id });
      const fifth = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [first, second, third, fourth, fifth]);

      const pageOne = yield* items.list(alice, { limit: 2, unreadOnly: false });
      const pageTwo = yield* items.list(alice, {
        after: fourth.id,
        limit: 2,
        unreadOnly: false,
      });
      const pageThree = yield* items.list(alice, {
        after: second.id,
        limit: 2,
        unreadOnly: false,
      });

      expect(idsOf([...pageOne, ...pageTwo, ...pageThree])).toEqual([
        fifth.id,
        fourth.id,
        third.id,
        second.id,
        first.id,
      ]);
    }).pipe(Effect.provide(layer))
  );
};

export const feedItemRepositoryContract = (
  name: string,
  layer: FeedStoreLayer
): void => {
  describe(name, () => {
    describe('find', findCases(layer));
    describe('list', () => {
      describe('order and limit', orderCases(layer));
      describe('cursor and feed', filterCases(layer));
      describe('unknown feed', unknownFeedCases(layer));
      describe('unread', unreadCases(layer));
      describe('deleted cursor', deletedCursorCases(layer));
      describe('every row', everyRowCases(layer));
    });
    describe('create', () => {
      describe('result and existing id', createResultCases(layer));
      describe('skips', createSkipCases(layer));
      describe('unique url per feed', createUniqueCases(layer));
    });
    describe('update', updateCases(layer));
    describe('mark as read', () => {
      describe('by feed', markFeedCases(layer));
      describe('all', markAllCases(layer));
    });
    describe('reports', () => {
      describe('unread counts', unreadCountCases(layer));
      describe('inventory', inventoryCases(layer));
    });
    describe('remove', removeCases(layer));
  });
};
