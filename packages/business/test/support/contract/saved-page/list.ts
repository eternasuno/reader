import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import {
  alice,
  bob,
  idsOf,
  pageRow,
  rowAt,
  savedPageQuery,
} from '../../fixtures';
import type { SavedPageStoreFactory } from '../layer';

const orderCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('SP-LIST-1 lists the newest pages first, at most limit', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const first = pageRow();
      const second = pageRow();
      const third = pageRow();
      yield* pages.create(alice, [first, second, third]);
      yield* pages.create(bob, [pageRow(bob)]);

      const page = yield* pages.list(alice, savedPageQuery({ limit: 2 }));

      expect(idsOf(page)).toEqual([third.id, second.id]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SP-LIST-2 lists only the pages of the owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const mine = pageRow();
      const theirs = pageRow(bob);
      yield* pages.create(alice, [mine]);
      yield* pages.create(bob, [theirs]);

      expect(idsOf(yield* pages.list(alice, savedPageQuery()))).toEqual([
        mine.id,
      ]);
      expect(idsOf(yield* pages.list(bob, savedPageQuery()))).toEqual([
        theirs.id,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const cursorCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect('CM-PAGE-3 lists only the pages strictly after the cursor', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const rows = [pageRow(), pageRow(), pageRow()];
      yield* pages.create(alice, rows);
      const cursor = Option.some(rowAt(rows, 1).id);

      const after = yield* pages.list(alice, savedPageQuery({ cursor }));

      expect(idsOf(after)).toEqual([rowAt(rows, 0).id]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const unreadCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect('CM-PAGE-8 returns unread pages only while unread is true', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const read = pageRow();
      const unread = pageRow();
      yield* pages.create(alice, [read, unread]);
      yield* pages.markRead(alice, [read.id], true);

      expect(
        idsOf(yield* pages.list(alice, savedPageQuery({ unread: true })))
      ).toEqual([unread.id]);
      expect(idsOf(yield* pages.list(alice, savedPageQuery()))).toEqual([
        unread.id,
        read.id,
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const deletedCursorCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect('CM-PAGE-6 keeps paging after the cursor row was removed', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const rows = [pageRow(), pageRow(), pageRow()];
      yield* pages.create(alice, rows);
      const cursor = rowAt(rows, 1).id;
      yield* pages.remove(alice, [cursor]);

      const page = yield* pages.list(
        alice,
        savedPageQuery({ cursor: Option.some(cursor) })
      );

      expect(idsOf(page)).toEqual([rowAt(rows, 0).id]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const pagesCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect('CM-PAGE-10 pages through every page once', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const rows = [pageRow(), pageRow(), pageRow(), pageRow(), pageRow()];
      yield* pages.create(alice, rows);
      const first = yield* pages.list(alice, savedPageQuery({ limit: 2 }));
      const second = yield* pages.list(
        alice,
        savedPageQuery({
          limit: 2,
          cursor: Option.some(rowAt(first, 1).id),
        })
      );
      const third = yield* pages.list(
        alice,
        savedPageQuery({
          limit: 2,
          cursor: Option.some(rowAt(second, 1).id),
        })
      );

      expect(idsOf([...first, ...second, ...third])).toEqual(
        idsOf(rows).reverse()
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const listCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  describe('order and limit', orderCases(makeLayer));
  describe('cursor and unread', () => {
    cursorCase(makeLayer);
    unreadCase(makeLayer);
    deletedCursorCase(makeLayer);
    pagesCase(makeLayer);
  });
};
