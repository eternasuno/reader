import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import {
  alice,
  bob,
  decodeTitle,
  makeUniqueFeed,
  makeUniqueFeedItem,
  storedFeed,
  uniqueUrl,
} from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';

const createResultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the ids of the created items', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });

      expect(yield* items.create(alice, [first, second])).toEqual([
        first.id,
        second.id,
      ]);
    }).pipe(Effect.provide(layer))
  );

  it.effect('skips a row whose id exists without overwriting it', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = makeUniqueFeedItem({
        feedId: feed.id,
        title: decodeTitle('Original'),
      });
      yield* items.create(alice, [item]);
      const duplicate = makeUniqueFeedItem({
        feedId: feed.id,
        id: item.id,
        title: decodeTitle('Contender'),
        read: true,
      });

      expect(yield* items.create(alice, [duplicate])).toEqual([]);
      expect(Option.getOrThrow(yield* items.find(alice, item.id))).toEqual(
        item
      );
      expect(
        yield* items.list(alice, { limit: 10, unreadOnly: false })
      ).toEqual([item]);
    }).pipe(Effect.provide(layer))
  );
};

const createSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a row whose feed already holds the url', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const url = uniqueUrl('item');
      const stored = makeUniqueFeedItem({
        feedId: feed.id,
        url,
        title: decodeTitle('Original'),
      });
      yield* items.create(alice, [stored]);
      const contender = makeUniqueFeedItem({
        feedId: feed.id,
        url,
        title: decodeTitle('Contender'),
        read: true,
      });

      expect(yield* items.create(alice, [contender])).toEqual([]);
      expect(Option.getOrThrow(yield* items.find(alice, stored.id))).toEqual(
        stored
      );
      expect(
        yield* items.list(alice, { limit: 10, unreadOnly: false })
      ).toEqual([stored]);
    }).pipe(Effect.provide(layer))
  );

  it.effect(
    'skips a row of another owner or of a missing or foreign feed',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const rows = [
          makeUniqueFeedItem({ feedId: feed.id, ownerId: bob }),
          makeUniqueFeedItem({ feedId: makeUniqueFeed().id }),
          makeUniqueFeedItem({ feedId: bobFeed.id }),
        ];

        expect(yield* items.create(alice, rows)).toEqual([]);
        expect(
          yield* items.list(alice, { limit: 10, unreadOnly: false })
        ).toEqual([]);
      }).pipe(Effect.provide(layer))
  );
};

const createUniqueCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('stores the same url in two feeds as two items', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const firstFeed = yield* storedFeed();
      const secondFeed = yield* storedFeed();
      const url = uniqueUrl('item');
      const created = yield* items.create(alice, [
        makeUniqueFeedItem({ feedId: firstFeed.id, url }),
        makeUniqueFeedItem({ feedId: secondFeed.id, url }),
      ]);

      expect(created).toHaveLength(2);
      expect(
        yield* items.list(alice, {
          feedId: secondFeed.id,
          limit: 10,
          unreadOnly: false,
        })
      ).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );

  it.effect('keeps one item when the same feed url is created at once', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const url = uniqueUrl('item');
      const created = yield* Effect.all(
        [
          items.create(alice, [makeUniqueFeedItem({ feedId: feed.id, url })]),
          items.create(alice, [makeUniqueFeedItem({ feedId: feed.id, url })]),
        ],
        { concurrency: 'unbounded' }
      );

      expect(created[0].length + created[1].length).toBe(1);
      expect(
        yield* items.list(alice, { limit: 10, unreadOnly: false })
      ).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );
};

export { createResultCases, createSkipCases, createUniqueCases };
