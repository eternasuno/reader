import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import { alice, bob, makeUniqueFeedItem, storedFeed } from '../support';
import {
  createResultCases,
  createSkipCases,
  createUniqueCases,
} from './feed-item-create-contract';
import { markFolderCases } from './feed-item-folder-state-contract';
import { listCases } from './feed-item-list-contract';
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

export const feedItemRepositoryContract = (
  name: string,
  layer: FeedStoreLayer
): void => {
  describe(name, () => {
    describe('find', findCases(layer));
    describe('list', listCases(layer));
    describe('create', () => {
      describe('result and existing id', createResultCases(layer));
      describe('skips', createSkipCases(layer));
      describe('unique url per feed', createUniqueCases(layer));
    });
    describe('update', updateCases(layer));
    describe('mark as read', () => {
      describe('by feed', markFeedCases(layer));
      describe('by folder', markFolderCases(layer));
      describe('all', markAllCases(layer));
    });
    describe('reports', () => {
      describe('unread counts', unreadCountCases(layer));
      describe('inventory', inventoryCases(layer));
    });
    describe('remove', removeCases(layer));
  });
};
