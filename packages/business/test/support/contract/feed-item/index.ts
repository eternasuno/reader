import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { alice, bob, itemRow, storedFeed } from '../../fixtures';
import type { FeedStoreFactory } from '../layer';
import { createCases } from './create';
import { listAllCases, listByFeedCases, listByFolderCases } from './list-scope';
import { readCases } from './read';
import { reportCases } from './report';
import { scopeReadCases } from './scope-read';

const findCases = (makeLayer: FeedStoreFactory) => (): void => {
  it.effect('FD-OPEN-1 finds the stored item of the owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = itemRow(feed.id);
      yield* items.create(alice, [item]);

      expect(Option.getOrThrow(yield* items.find(alice, item.id))).toEqual(
        item
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'FD-OPEN-2 reports a foreign item and an unknown id as missing',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const mine = yield* storedFeed();
        const theirs = yield* storedFeed(bob);
        const foreign = itemRow(theirs.id, { ownerId: bob });
        const unknown = itemRow(mine.id);
        yield* items.create(bob, [foreign]);

        expect(Option.isNone(yield* items.find(alice, foreign.id))).toBe(true);
        expect(Option.isNone(yield* items.find(alice, unknown.id))).toBe(true);
        expect(Option.isSome(yield* items.find(bob, foreign.id))).toBe(true);
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const feedItemRepositoryContract = (
  makeLayer: FeedStoreFactory
): void => {
  describe('FeedItemRepository', () => {
    describe('find', findCases(makeLayer));
    describe('create', createCases(makeLayer));
    listAllCases(makeLayer);
    listByFeedCases(makeLayer);
    listByFolderCases(makeLayer);
    describe('read state', readCases(makeLayer));
    describe('read state by scope', scopeReadCases(makeLayer));
    describe('reports and remove', reportCases(makeLayer));
  });
};
