import { describe, expect, it } from '@effect/vitest';
import { Effect, type Layer, Option } from 'effect';
import type { FeedId } from '../../src/entity/feed/feed';
import { FeedTitle } from '../../src/entity/feed/feed';
import type { FeedItemRepository } from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { alice, bob, makeFeed, makeUniqueFeed, uniqueUrl } from '../support';
import { removalCases } from './feed-repository-removal-contract';
import { feedRow, updatedTime } from './feed-store-row';

export type FeedStoreLayer = Layer.Layer<
  FeedRepository | FeedItemRepository,
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

const updateResultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the existing ids among the given ids once', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const first = feedRow();
      const second = feedRow();
      const foreign = feedRow('Foreign', bob);
      yield* feeds.create(alice, [first, second]);
      yield* feeds.create(bob, [foreign]);

      const updated = yield* feeds.update(
        alice,
        [first.id, foreign.id, second.id, first.id, makeFeed().id],
        { title: FeedTitle.make('Renamed') }
      );

      expect(updated).toHaveLength(2);
      expect(new Set(updated)).toEqual(new Set<FeedId>([first.id, second.id]));
    }).pipe(Effect.provide(layer))
  );
};

const updateRepeatedCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns each existing id once for a repeated or empty patch', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const first = feedRow();
      const second = feedRow();
      yield* feeds.create(alice, [first, second]);
      const ids = [first.id, second.id, first.id];
      const both = new Set([first.id, second.id]);

      const patched = yield* feeds.update(alice, ids, {
        title: FeedTitle.make('Same'),
      });
      const empty = yield* feeds.update(alice, ids, {});

      expect(patched).toHaveLength(2);
      expect(new Set(patched)).toEqual(both);
      expect(empty).toHaveLength(2);
      expect(new Set(empty)).toEqual(both);
    }).pipe(Effect.provide(layer))
  );

  it.effect('changes nothing for an empty id list', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow('Original');
      yield* feeds.create(alice, [feed]);

      expect(
        yield* feeds.update(alice, [], { title: FeedTitle.make('Renamed') })
      ).toEqual([]);
      expect(Option.getOrThrow(yield* feeds.find(alice, feed.id))).toEqual(
        feed
      );
    }).pipe(Effect.provide(layer))
  );
};

const updatePatchCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('sets the title and the updated time of the patch', () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = feedRow();
      const updatedAt = updatedTime();
      yield* feeds.create(alice, [feed]);
      yield* feeds.update(alice, [feed.id], {
        title: FeedTitle.make('Renamed'),
        updatedAt: Option.some(updatedAt),
      });

      const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

      expect(stored.title).toBe('Renamed');
      expect(Option.getOrThrow(stored.updatedAt).epochMilliseconds).toBe(
        updatedAt.epochMilliseconds
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect(
    'keeps a field the patch leaves out and clears time with none',
    () =>
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        const feed = feedRow();
        yield* feeds.create(alice, [feed]);
        yield* feeds.update(alice, [feed.id], {
          title: FeedTitle.make('Renamed'),
          updatedAt: Option.some(updatedTime()),
        });
        yield* feeds.update(alice, [feed.id], { updatedAt: Option.none() });

        const stored = Option.getOrThrow(yield* feeds.find(alice, feed.id));

        expect(stored.title).toBe('Renamed');
        expect(Option.isNone(stored.updatedAt)).toBe(true);
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
    describe('update', () => {
      describe('result', updateResultCases(layer));
      describe('repeated and empty patch', updateRepeatedCases(layer));
      describe('patch', updatePatchCases(layer));
    });
    describe('remove', removalCases(layer));
  });
};
