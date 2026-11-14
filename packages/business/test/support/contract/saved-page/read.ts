import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import { alice, bob, pageRow } from '../../fixtures';
import type { SavedPageStoreLayer } from '.';

const markReadCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect(
    'SP-READ-1 marks the owner pages among the ids and ignores foreign and unknown ids',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const mine = pageRow();
        const foreign = pageRow(bob);
        yield* pages.create(alice, [mine]);
        yield* pages.create(bob, [foreign]);
        yield* pages.markRead(
          alice,
          [mine.id, foreign.id, mine.id, pageRow().id],
          true
        );

        expect(Option.getOrThrow(yield* pages.find(alice, mine.id)).read).toBe(
          true
        );
        expect(Option.getOrThrow(yield* pages.find(bob, foreign.id)).read).toBe(
          false
        );
      }).pipe(Effect.provide(layer))
  );
};

const markReadTwiceCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect(
    'SP-READ-2 marking twice is idempotent and marking back clears read',
    () =>
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const first = pageRow();
        const second = pageRow();
        yield* pages.create(alice, [first, second]);
        const ids = [first.id, second.id];

        yield* pages.markRead(alice, ids, true);
        yield* pages.markRead(alice, ids, true);

        expect(Option.getOrThrow(yield* pages.find(alice, first.id)).read).toBe(
          true
        );
        expect(
          Option.getOrThrow(yield* pages.find(alice, second.id)).read
        ).toBe(true);

        yield* pages.markRead(alice, ids, false);

        expect(Option.getOrThrow(yield* pages.find(alice, first.id)).read).toBe(
          false
        );
        expect(
          Option.getOrThrow(yield* pages.find(alice, second.id)).read
        ).toBe(false);
      }).pipe(Effect.provide(layer))
  );
};

const markReadEmptyIdsCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('SP-READ-1 changes nothing for an empty id list', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);
      yield* pages.markRead(alice, [], true);

      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
    }).pipe(Effect.provide(layer))
  );
};

const markAllReadCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('marks the owner pages read and leaves others unread', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const mine = pageRow();
      const foreign = pageRow(bob);
      yield* pages.create(alice, [mine]);
      yield* pages.create(bob, [foreign]);
      yield* pages.markAllRead(alice);

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
  describe('ids', markReadCases(layer));
  describe('twice', markReadTwiceCases(layer));
  describe('empty id list', markReadEmptyIdsCases(layer));
  describe('all', markAllReadCases(layer));
};
