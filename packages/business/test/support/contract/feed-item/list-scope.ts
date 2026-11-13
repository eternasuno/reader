import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import {
  alice,
  bob,
  idsOf,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueFolder,
  rowAt,
  storedFeed,
  storedFolder,
  storedFolderFeed,
} from '../../fixtures';
import type { FeedStoreLayer } from '../feed';
import type { ListScope } from './list';

const query = { limit: 10, unreadOnly: false };

const feedExclusionCases =
  (layer: FeedStoreLayer, scope: ListScope) => (): void => {
    it.effect('excludes the items of other feeds', () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const setup = yield* scope((feedId) => [
          makeUniqueFeedItem({ feedId }),
        ]);
        const other = yield* storedFeed();
        yield* items.create(alice, [makeUniqueFeedItem({ feedId: other.id })]);
        const listed = yield* setup.list(query);

        expect(idsOf(listed)).toEqual([rowAt(setup.rows, 0).id]);
      }).pipe(Effect.provide(layer))
    );
  };

const feedEmptyCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns an empty page for an unknown or foreign feed', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      yield* items.create(alice, [makeUniqueFeedItem({ feedId: feed.id })]);

      expect(
        yield* items.listByFeed(alice, makeUniqueFeed().id, query)
      ).toEqual([]);
      expect(yield* items.listByFeed(alice, bobFeed.id, query)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const folderMergeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'merges the items of several feeds in the folder newest first',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const folder = yield* storedFolder();
        const first = yield* storedFolderFeed(folder.id);
        const second = yield* storedFolderFeed(folder.id);
        const rows = [
          makeUniqueFeedItem({ feedId: first.id }),
          makeUniqueFeedItem({ feedId: second.id }),
          makeUniqueFeedItem({ feedId: first.id }),
        ];
        yield* items.create(alice, rows);
        const listed = yield* items.listByFolder(alice, folder.id, query);

        expect(idsOf(listed)).toEqual(idsOf(rows).reverse());
      }).pipe(Effect.provide(layer))
  );
};

const folderExclusionCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('excludes top-level feeds and feeds of other folders', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const otherFolder = yield* storedFolder();
      const inside = yield* storedFolderFeed(folder.id);
      const topLevel = yield* storedFeed();
      const elsewhere = yield* storedFolderFeed(otherFolder.id);
      const mine = makeUniqueFeedItem({ feedId: inside.id });
      yield* items.create(alice, [
        mine,
        makeUniqueFeedItem({ feedId: topLevel.id }),
        makeUniqueFeedItem({ feedId: elsewhere.id }),
      ]);
      const listed = yield* items.listByFolder(alice, folder.id, query);

      expect(idsOf(listed)).toEqual([mine.id]);
    }).pipe(Effect.provide(layer))
  );
};

const folderEmptyCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'returns an empty page for an unknown, foreign or empty folder',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFolder = yield* storedFolder(bob);
        const bobFeed = yield* storedFolderFeed(bobFolder.id, bob);
        const empty = yield* storedFolder();
        yield* items.create(alice, [makeUniqueFeedItem({ feedId: feed.id })]);
        yield* items.create(bob, [
          makeUniqueFeedItem({ ownerId: bob, feedId: bobFeed.id }),
        ]);

        expect(
          yield* items.listByFolder(alice, makeUniqueFolder().id, query)
        ).toEqual([]);
        expect(yield* items.listByFolder(alice, bobFolder.id, query)).toEqual(
          []
        );
        expect(yield* items.listByFolder(alice, empty.id, query)).toEqual([]);
      }).pipe(Effect.provide(layer))
  );
};

const folderMovedOutCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('stops listing a feed moved out of the folder', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feeds = yield* FeedRepository;
      const folder = yield* storedFolder();
      const feed = yield* storedFolderFeed(folder.id);
      const row = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [row]);

      expect(idsOf(yield* items.listByFolder(alice, folder.id, query))).toEqual(
        [row.id]
      );

      yield* feeds.moveToFolder(alice, feed.id, Option.none());

      expect(yield* items.listByFolder(alice, folder.id, query)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const allFolderCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('lists the items of feeds in folders too', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const folder = yield* storedFolder();
      const inFolder = yield* storedFolderFeed(folder.id);
      const topLevel = yield* storedFeed();
      const rows = [
        makeUniqueFeedItem({ feedId: inFolder.id }),
        makeUniqueFeedItem({ feedId: topLevel.id }),
      ];
      yield* items.create(alice, rows);
      const listed = yield* items.listAll(alice, query);

      expect(idsOf(listed)).toEqual(idsOf(rows).reverse());
    }).pipe(Effect.provide(layer))
  );
};

export {
  allFolderCases,
  feedEmptyCases,
  feedExclusionCases,
  folderEmptyCases,
  folderExclusionCases,
  folderMergeCases,
  folderMovedOutCases,
};
