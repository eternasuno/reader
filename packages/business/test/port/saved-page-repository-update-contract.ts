import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SavedPageRepository } from '../../src/port/saved-page-repository';
import { alice, bob } from '../support';
import type { SavedPageStoreLayer } from './saved-page-repository-contract';
import { pageRow } from './saved-page-store-row';

const updateResultCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('returns the existing ids once and ignores foreign ids', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const mine = pageRow();
      const foreign = pageRow(bob);
      yield* pages.create(alice, [mine]);
      yield* pages.create(bob, [foreign]);

      const updated = yield* pages.update(
        alice,
        [mine.id, foreign.id, mine.id, pageRow().id],
        { read: true }
      );

      expect(updated).toEqual([mine.id]);
      expect(Option.getOrThrow(yield* pages.find(bob, foreign.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

const updateRepeatCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('returns each existing id once for a repeated or empty patch', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      yield* pages.create(alice, [first, second]);
      const ids = [first.id, second.id];

      const patched = yield* pages.update(alice, ids, { read: true });
      const again = yield* pages.update(alice, ids, { read: true });
      const emptyPatch = yield* pages.update(alice, ids, {});
      const both = new Set(ids);

      expect(patched).toHaveLength(2);
      expect(new Set(patched)).toEqual(both);
      expect(new Set(again)).toEqual(both);
      expect(new Set(emptyPatch)).toEqual(both);
    }).pipe(Effect.provide(layer))
  );
};

const updateEmptyIdsCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('changes nothing for an empty id list', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      expect(yield* pages.update(alice, [], { read: true })).toEqual([]);
      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
    }).pipe(Effect.provide(layer))
  );
};

const updateAllCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('marks the owner pages read and leaves others unread', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const mine = pageRow();
      const foreign = pageRow(bob);
      yield* pages.create(alice, [mine]);
      yield* pages.create(bob, [foreign]);
      yield* pages.updateAll(alice, { read: true });

      expect(Option.getOrThrow(yield* pages.find(alice, mine.id)).read).toBe(
        true
      );
      expect(Option.getOrThrow(yield* pages.find(bob, foreign.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

export const updateCases = (layer: SavedPageStoreLayer) => (): void => {
  describe('result', updateResultCases(layer));
  describe('repeated and empty patch', updateRepeatCases(layer));
  describe('empty id list', updateEmptyIdsCases(layer));
  describe('all', updateAllCases(layer));
};
