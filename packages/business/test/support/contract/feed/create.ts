import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  feedRow,
  idsOf,
  makeFeed,
  makeUniqueFeed,
  sortedIds,
  uniqueUrl,
  updatedTime,
} from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const resultCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-PORT-6 returns the ids of the created feeds', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const first = feedRow();
      const second = feedRow();

      expect(sortedIds(yield* feeds.create(alice, [first, second]))).toEqual(
        sortedIds(idsOf([first, second]))
      );
      expect(yield* feeds.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('CM-PORT-6 skips one row and keeps the rest of the batch', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const stored = makeFeed({ ownerId: alice, url });
      const contender = makeUniqueFeed({ ownerId: alice, url });
      const fresh = feedRow();
      yield* feeds.create(alice, [stored]);

      expect(yield* feeds.create(alice, [contender, fresh])).toEqual([
        fresh.id,
      ]);
      expect(yield* feeds.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const idSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose id exists without overwriting it',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const feed = feedRow('Original');
        yield* feeds.create(alice, [feed]);
        const duplicate = makeUniqueFeed({
          id: feed.id,
          ownerId: alice,
          title: FeedTitle.make('Contender'),
          updatedAt: Option.some(updatedTime()),
        });

        expect(yield* feeds.create(alice, [duplicate])).toEqual([]);
        expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
          feed
        );
        expect(yield* feeds.list(alice)).toEqual([feed]);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const urlSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('CM-ID-6 skips a row whose url the owner already follows', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const stored = makeUniqueFeed({
        ownerId: alice,
        url,
        title: FeedTitle.make('Original'),
      });
      yield* feeds.create(alice, [stored]);
      const contender = makeUniqueFeed({
        ownerId: alice,
        url,
        title: FeedTitle.make('Contender'),
      });

      expect(yield* feeds.create(alice, [contender])).toEqual([]);
      expect(Option.getOrThrow(yield* feeds.find(alice, stored.id))).toEqual(
        stored
      );
      expect(yield* feeds.list(alice)).toEqual([stored]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const ownerSkipCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-PORT-6 skips a row whose owner is not the owner passed in',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const foreign = feedRow('Foreign', bob);

        expect(yield* feeds.create(alice, [foreign])).toEqual([]);
        expect(yield* feeds.list(alice)).toEqual([]);
        expect(yield* feeds.list(bob)).toEqual([]);
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('FD-ID-1 stores the same url for two owners as two feeds', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const mine = makeFeed({ ownerId: alice, url });
      const other = makeFeed({ ownerId: bob, url });

      expect(yield* feeds.create(alice, [mine])).toEqual([mine.id]);
      expect(yield* feeds.create(bob, [other])).toEqual([other.id]);
      expect(yield* feeds.list(alice)).toEqual([mine]);
      expect(yield* feeds.list(bob)).toEqual([other]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const concurrentCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect(
    'CM-ID-6 creates one feed for two concurrent creates of one url',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const url = uniqueUrl('feed');
        const first = makeFeed({ ownerId: alice, url });
        const second = makeFeed({ ownerId: alice, url });
        const created = yield* Effect.all(
          [feeds.create(alice, [first]), feeds.create(alice, [second])],
          { concurrency: 'unbounded' }
        );

        expect(created[0].length + created[1].length).toBe(1);
        expect(yield* feeds.list(alice)).toHaveLength(1);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const createCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('result', resultCases(makeLayer));
  describe('existing id', idSkipCases(makeLayer));
  describe('existing url', urlSkipCases(makeLayer));
  describe('owner', ownerSkipCases(makeLayer));
  describe('concurrent creates', concurrentCases(makeLayer));
};
