import { describe, expect, it } from '@effect/vitest';
import { Effect, type Layer, Option } from 'effect';
import { SavedPageRepository } from '../../src/port/saved-page-repository';
import { alice, bob, idsOf, makeUniqueSavedPage, uniqueUrl } from '../support';
import { createCases } from './saved-page-repository-create-contract';
import { updateCases } from './saved-page-repository-update-contract';
import { pageRow } from './saved-page-store-row';

export type SavedPageStoreLayer = Layer.Layer<SavedPageRepository, unknown>;

const findCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('returns the stored page of the owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
    }).pipe(Effect.provide(layer))
  );

  it.effect('reports a foreign page and an unknown id as missing', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(Option.isNone(yield* pages.find(bob, page.id))).toBe(true);
      expect(Option.isNone(yield* pages.find(alice, pageRow().id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );

  it.effect('looks a page up by its url for the owner only', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(
        Option.getOrThrow(yield* pages.findByUrl(alice, page.url))
      ).toEqual(page);
      expect(Option.isNone(yield* pages.findByUrl(bob, page.url))).toBe(true);
      expect(
        Option.isNone(yield* pages.findByUrl(alice, uniqueUrl('page')))
      ).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const listCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('lists the owner pages newest first at most limit', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      const third = pageRow();
      yield* pages.create(alice, [first, second, third]);
      yield* pages.create(bob, [pageRow(bob)]);

      const page = yield* pages.list(alice, { limit: 2, unreadOnly: false });

      expect(idsOf(page)).toEqual([third.id, second.id]);
    }).pipe(Effect.provide(layer))
  );

  it.effect('applies the cursor, the limit and the unread filter', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      const third = pageRow();
      yield* pages.create(alice, [first, second, third]);
      yield* pages.update(alice, [third.id], { read: true });
      yield* pages.create(bob, [pageRow(bob)]);

      const after = yield* pages.list(alice, {
        after: third.id,
        limit: 1,
        unreadOnly: false,
      });

      expect(idsOf(after)).toEqual([second.id]);
      expect(
        idsOf(yield* pages.list(alice, { limit: 10, unreadOnly: true }))
      ).toEqual([second.id, first.id]);
    }).pipe(Effect.provide(layer))
  );
};

const removeCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('removes the owner pages among the ids and ignores others', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const removed = pageRow();
      const kept = pageRow();
      const foreign = pageRow(bob);
      yield* pages.create(alice, [removed, kept]);
      yield* pages.create(bob, [foreign]);
      yield* pages.remove(alice, [removed.id, foreign.id, pageRow().id]);
      yield* pages.remove(alice, [removed.id]);

      expect(Option.isNone(yield* pages.find(alice, removed.id))).toBe(true);
      expect(Option.isSome(yield* pages.find(alice, kept.id))).toBe(true);
      expect(Option.isSome(yield* pages.find(bob, foreign.id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );

  it.effect('allows adding the same url again after removal', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const first = makeUniqueSavedPage({ url });
      yield* pages.create(alice, [first]);
      yield* pages.remove(alice, [first.id]);
      const second = makeUniqueSavedPage({ url });
      yield* pages.create(alice, [second]);

      const stored = Option.getOrThrow(yield* pages.findByUrl(alice, url));

      expect(stored.id).toBe(second.id);
      expect(stored.id > first.id).toBe(true);
      expect(stored.read).toBe(false);
    }).pipe(Effect.provide(layer))
  );

  it.effect('counts the unread pages of the owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const read = pageRow();
      const unread = pageRow();
      yield* pages.create(alice, [read, unread]);
      yield* pages.create(bob, [pageRow(bob)]);
      yield* pages.update(alice, [read.id], { read: true });

      expect(yield* pages.unreadCount(alice)).toBe(1);
      expect(yield* pages.unreadCount(bob)).toBe(1);
    }).pipe(Effect.provide(layer))
  );
};

export const savedPageRepositoryContract = (
  name: string,
  layer: SavedPageStoreLayer
): void => {
  describe(name, () => {
    describe('find', findCases(layer));
    describe('list', listCases(layer));
    describe('create', createCases(layer));
    describe('update', updateCases(layer));
    describe('remove and count', removeCases(layer));
  });
};
