import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SavedPageRepository } from '../../../../src/port/saved-page-repository';
import {
  alice,
  bob,
  makeUniqueSavedPage,
  pageRow,
  uniqueUrl,
} from '../../fixtures';
import type { SavedPageStoreFactory } from '../layer';

const markReadScopeCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect(
    'SP-READ-1 marks the owner pages among the ids and ignores others',
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
      }).pipe(Effect.provide(makeLayer()))
  );
};

const markReadTwiceCase = (makeLayer: SavedPageStoreFactory): void => {
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

        yield* pages.markRead(alice, ids, false);

        expect(Option.getOrThrow(yield* pages.find(alice, first.id)).read).toBe(
          false
        );
        expect(
          Option.getOrThrow(yield* pages.find(alice, second.id)).read
        ).toBe(false);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const markReadEmptyCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect('CM-PORT-5 an empty id list changes nothing', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const page = pageRow();
      yield* pages.create(alice, [page]);

      yield* pages.markRead(alice, [], true);

      expect(Option.getOrThrow(yield* pages.find(alice, page.id))).toEqual(
        page
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

const markAllReadCase = (makeLayer: SavedPageStoreFactory): void => {
  it.effect(
    'SP-READ marks every page of the owner and no other owner page',
    () =>
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
      }).pipe(Effect.provide(makeLayer()))
  );
};

const removeCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect(
    'SP-REMOVE-1 removes the owner pages among the ids and ignores others',
    () =>
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
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SP-REMOVE-2 allows saving the same url again after removal', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const url = uniqueUrl('page');
      const first = makeUniqueSavedPage({ url });
      yield* pages.create(alice, [first]);
      yield* pages.remove(alice, [first.id]);
      const second = makeUniqueSavedPage({ url });

      expect(yield* pages.create(alice, [second])).toEqual([second.id]);

      const stored = Option.getOrThrow(yield* pages.findByUrl(alice, url));

      expect(stored.id).toBe(second.id);
      expect(stored.id > first.id).toBe(true);
      expect(stored.read).toBe(false);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const countCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  it.effect('SP-COUNT-1 counts the unread pages of the owner', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const read = pageRow();
      const unread = pageRow();
      yield* pages.create(alice, [read, unread]);
      yield* pages.create(bob, [pageRow(bob)]);
      yield* pages.markRead(alice, [read.id], true);

      expect(yield* pages.unreadCount(alice)).toBe(1);
      expect(yield* pages.unreadCount(bob)).toBe(1);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SP-COUNT-1 counts nothing after marking all pages read', () =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      yield* pages.create(alice, [pageRow(), pageRow()]);

      yield* pages.markAllRead(alice);

      expect(yield* pages.unreadCount(alice)).toBe(0);
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const readCases = (makeLayer: SavedPageStoreFactory) => (): void => {
  describe('mark read', () => {
    markReadScopeCase(makeLayer);
    markReadTwiceCase(makeLayer);
    markReadEmptyCase(makeLayer);
    markAllReadCase(makeLayer);
  });
  describe('remove', removeCases(makeLayer));
  describe('unread count', countCases(makeLayer));
};
