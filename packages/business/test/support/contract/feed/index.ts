import { describe, expect, it } from '@effect/vitest';
import { Effect, type Layer, Option } from 'effect';
import { FeedTitle } from '../../../../src/entity/feed/feed';
import type { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import type { FolderRepository } from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  feedRow,
  makeFeed,
  makeUniqueFeed,
  uniqueUrl,
  updatedTime,
} from '../../fixtures';
import { folderCases } from './folder';
import { removalCases } from './removal';

export type FeedStoreLayer = Layer.Layer<
  FeedRepository | FeedItemRepository | FolderRepository,
  unknown
>;

const findCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the stored feed of the owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      yield* feeds.create(alice, [feed]);

      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
        feed
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('reports a foreign feed and an unknown id as missing', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      yield* feeds.create(alice, [feed]);

      expect(Option.isNone(yield* feeds.find(bob, feed.id))).toBe(true);
      expect(Option.isNone(yield* feeds.find(alice, makeFeed().id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const listCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('lists the feeds of the owner by title then id', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const sameFirst = feedRow('Same');
      const alpha = feedRow('Alpha');
      const sameSecond = feedRow('Same');
      yield* feeds.create(alice, [sameFirst, alpha, sameSecond]);
      yield* feeds.create(bob, [feedRow('Aardvark', bob)]);

      const listed = yield* feeds.list(alice);

      expect(listed.map((feed) => feed.title)).toEqual([
        'Alpha',
        'Same',
        'Same',
      ]);
      expect(listed.map((feed) => feed.id)).toEqual([
        alpha.id,
        sameFirst.id,
        sameSecond.id,
      ]);
    }).pipe(Effect.provide(layer))
  );
};

const createResultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the ids of the created feeds', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const first = feedRow();
      const second = feedRow();

      expect(yield* feeds.create(alice, [first, second])).toEqual([
        first.id,
        second.id,
      ]);
      expect(yield* feeds.list(alice)).toHaveLength(2);
    }).pipe(Effect.provide(layer))
  );
};

const createIdSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a row whose id exists without overwriting it', () =>
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
    }).pipe(Effect.provide(layer))
  );
};

const createUrlSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a row whose url the owner already follows', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const stored = makeUniqueFeed({
        ownerId: alice,
        url,
        title: FeedTitle.make('Original'),
      });
      yield* feeds.create(alice, [stored]);
      const duplicate = makeUniqueFeed({
        ownerId: alice,
        url,
        title: FeedTitle.make('Contender'),
      });

      expect(yield* feeds.create(alice, [duplicate])).toEqual([]);
      expect(Option.getOrThrow(yield* feeds.find(alice, stored.id))).toEqual(
        stored
      );
      expect(yield* feeds.list(alice)).toEqual([stored]);
    }).pipe(Effect.provide(layer))
  );
};

const createOwnerSkipCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('skips a row of another owner', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);

      expect(yield* feeds.create(alice, [foreign])).toEqual([]);
      expect(yield* feeds.list(alice)).toEqual([]);
      expect(yield* feeds.list(bob)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const createUniqueCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('stores the same url for two owners as two feeds', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const url = uniqueUrl('feed');
      const mine = makeFeed({ ownerId: alice, url });
      const other = makeFeed({ ownerId: bob, url });
      const mineCreated = yield* feeds.create(alice, [mine]);
      const otherCreated = yield* feeds.create(bob, [other]);

      expect(mineCreated).toEqual([mine.id]);
      expect(otherCreated).toEqual([other.id]);
      expect(yield* feeds.list(alice)).toHaveLength(1);
      expect(yield* feeds.list(bob)).toHaveLength(1);
    }).pipe(Effect.provide(layer))
  );

  it.effect('creates one feed when the same url is created concurrently', () =>
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
    }).pipe(Effect.provide(layer))
  );
};

const recordSyncCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-SYNC sets the title and the updated time', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      const at = updatedTime();
      yield* feeds.create(alice, [feed]);

      yield* feeds.recordSync(alice, feed.id, FeedTitle.make('Renamed'), at);

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(stored.title).toBe('Renamed');
      expect(Option.getOrThrow(stored.updatedAt).epochMilliseconds).toBe(
        at.epochMilliseconds
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('FD-SYNC-5 changes nothing for an unknown or foreign feed', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const foreign = feedRow('Foreign', bob);
      yield* feeds.create(bob, [foreign]);

      yield* feeds.recordSync(
        alice,
        foreign.id,
        FeedTitle.make('Renamed'),
        updatedTime()
      );
      yield* feeds.recordSync(
        alice,
        makeFeed().id,
        FeedTitle.make('Renamed'),
        updatedTime()
      );

      expect(Option.getOrThrow(yield* feeds.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(layer))
  );
};

export const feedRepositoryContract = (
  name: string,
  layer: FeedStoreLayer
): void => {
  describe(name, () => {
    describe('find', findCases(layer));
    describe('list', listCases(layer));
    describe('create', () => {
      describe('result', createResultCases(layer));
      describe('skips', () => {
        describe('existing id', createIdSkipCases(layer));
        describe('existing url', createUrlSkipCases(layer));
        describe('foreign owner', createOwnerSkipCases(layer));
      });
      describe('unique url per owner', createUniqueCases(layer));
    });
    describe('record sync', recordSyncCases(layer));
    describe('folder', folderCases(layer));
    describe('remove', removalCases(layer));
  });
};
