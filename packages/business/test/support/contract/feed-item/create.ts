import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import {
  alice,
  bob,
  decodeTitle,
  feedItemQuery,
  idsOf,
  itemRow,
  makeUniqueFeed,
  sortedIds,
  storedFeed,
  uniqueUrl,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const resultCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-PORT-6 returns the ids of the created items', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const first = itemRow(feed.id);
      const second = itemRow(feed.id);

      expect(sortedIds(yield* items.create(alice, [first, second]))).toEqual(
        sortedIds(idsOf([first, second]))
      );
      expect(yield* items.listAll(alice, feedItemQuery())).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('CM-PORT-6 skips one row and keeps the rest of the batch', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const stored = itemRow(feed.id);
      const fresh = itemRow(feed.id);
      yield* items.create(alice, [stored]);

      expect(yield* items.create(alice, [stored, fresh])).toEqual([fresh.id]);
      expect(yield* items.listAll(alice, feedItemQuery())).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const idSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose id exists without overwriting it',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const item = itemRow(feed.id, { title: decodeTitle('Original') });
        yield* items.create(alice, [item]);
        const duplicate = itemRow(feed.id, {
          id: item.id,
          title: decodeTitle('Contender'),
          read: true,
        });

        expect(yield* items.create(alice, [duplicate])).toEqual([]);
        expect(Option.getOrThrow(yield* items.find(alice, item.id))).toEqual(
          item
        );
        expect(yield* items.listAll(alice, feedItemQuery())).toEqual([item]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const urlSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-ID-6 skips a row whose feed already holds its url', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const url = uniqueUrl('item');
      const stored = itemRow(feed.id, {
        url,
        title: decodeTitle('Original'),
      });
      yield* items.create(alice, [stored]);
      const contender = itemRow(feed.id, {
        url,
        title: decodeTitle('Contender'),
        read: true,
      });

      expect(yield* items.create(alice, [contender])).toEqual([]);
      expect(Option.getOrThrow(yield* items.find(alice, stored.id))).toEqual(
        stored
      );
      expect(yield* items.listAll(alice, feedItemQuery())).toEqual([stored]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const ownerAndFeedSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row of another owner, a foreign feed or a missing feed',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const rows = [
          itemRow(feed.id, { ownerId: bob }),
          itemRow(makeUniqueFeed().id),
          itemRow(bobFeed.id),
        ];

        expect(yield* items.create(alice, rows)).toEqual([]);
        expect(yield* items.listAll(alice, feedItemQuery())).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const uniqueCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-ID-3 stores the same url in two feeds as two items', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const firstFeed = yield* storedFeed();
      const secondFeed = yield* storedFeed();
      const url = uniqueUrl('item');

      const created = yield* items.create(alice, [
        itemRow(firstFeed.id, { url }),
        itemRow(secondFeed.id, { url }),
      ]);

      expect(created).toHaveLength(2);
      expect(
        yield* items.listByFeed(alice, secondFeed.id, feedItemQuery())
      ).toHaveLength(1);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-ID-6 keeps one item when one url is created twice at once',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const url = uniqueUrl('item');
        const created = yield* Effect.all(
          [
            items.create(alice, [itemRow(feed.id, { url })]),
            items.create(alice, [itemRow(feed.id, { url })]),
          ],
          { concurrency: 'unbounded' }
        );

        expect(created[0].length + created[1].length).toBe(1);
        expect(yield* items.listAll(alice, feedItemQuery())).toHaveLength(1);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const createCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('result', resultCases(makeLayer));
  describe('existing id', idSkipCases(makeLayer));
  describe('existing url', urlSkipCases(makeLayer));
  describe('owner and feed', ownerAndFeedSkipCases(makeLayer));
  describe('unique url per feed', uniqueCases(makeLayer));
};
