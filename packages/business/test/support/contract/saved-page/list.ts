import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import { alice, bob, idsOf, pageRow } from '../../fixtures';
import type { SavedPageStoreLayer } from '.';

const orderCases = (layer: SavedPageStoreLayer) => (): void => {
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
};

const filterCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('applies the cursor, the limit and the unread filter', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      const third = pageRow();
      yield* pages.create(alice, [first, second, third]);
      yield* pages.markRead(alice, [third.id], true);
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

const deletedCursorCases = (layer: SavedPageStoreLayer) => (): void => {
  it.effect('CM-PAGE-6 keeps paging after the cursor row was removed', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      const third = pageRow();
      yield* pages.create(alice, [first, second, third]);
      yield* pages.remove(alice, [second.id]);

      expect(
        idsOf(
          yield* pages.list(alice, {
            after: second.id,
            limit: 10,
            unreadOnly: false,
          })
        )
      ).toEqual([first.id]);
    }).pipe(Effect.provide(layer))
  );
};

export const listCases = (layer: SavedPageStoreLayer) => (): void => {
  describe('order and limit', orderCases(layer));
  describe('cursor and filter', filterCases(layer));
  describe('deleted cursor', deletedCursorCases(layer));
};
