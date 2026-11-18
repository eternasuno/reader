import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { FeedId } from '../../../../src/entity/feed/feed';
import type { FeedItem } from '../../../../src/entity/feed-item/feed-item';
import type { FeedRepositoryError } from '../../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../../src/error/feed-item';
import type { FolderRepositoryError } from '../../../../src/error/folder';
import {
  type FeedItemQuery,
  FeedItemRepository,
} from '../../../../src/port/feed-item-repository';
import {
  alice,
  type FeedItemOverrides,
  feedItemQuery,
  idsOf,
  itemRow,
  rowAt,
} from '../../fixtures';
import type { FeedStoreFactory, FeedStorePorts } from '../layer';

export type Lister = (
  query: FeedItemQuery
) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;

/** One scope, seeded with the rows it should list, oldest first. */
export type ListSetup = {
  readonly feedId: FeedId;
  readonly rows: ReadonlyArray<FeedItem>;
  readonly list: Lister;
};

export type ScopeError =
  | FeedItemRepositoryError
  | FeedRepositoryError
  | FolderRepositoryError;

export type ListScopeSetup = (
  makeRows: (feedId: FeedId) => ReadonlyArray<FeedItem>
) => Effect.Effect<ListSetup, ScopeError, FeedStorePorts>;

const optionOf = Option.some;

const seedRows = (
  scope: ListScopeSetup,
  count: number,
  overrides: (index: number) => FeedItemOverrides
): Effect.Effect<ListSetup, ScopeError, FeedStorePorts> =>
  scope((feedId) =>
    Array.from({ length: count }, (_unused, index) =>
      itemRow(feedId, overrides(index))
    )
  );

const orderCases =
  (makeLayer: FeedStoreFactory, scope: ListScopeSetup) => (): void => {
    it.effect('CM-PAGE-1 lists the newest rows first, at most limit', () =>
      Effect.gen(function* () {
        const setup = yield* seedRows(scope, 3, () => ({}));
        const page = yield* setup.list(feedItemQuery({ limit: 2 }));

        expect(idsOf(page)).toEqual([
          rowAt(setup.rows, 2).id,
          rowAt(setup.rows, 1).id,
        ]);
      }).pipe(Effect.provide(makeLayer()))
    );
  };

const cursorCases =
  (makeLayer: FeedStoreFactory, scope: ListScopeSetup) => (): void => {
    it.effect('CM-PAGE-3 lists only the rows strictly after the cursor', () =>
      Effect.gen(function* () {
        const setup = yield* seedRows(scope, 3, () => ({}));
        const cursor = optionOf(rowAt(setup.rows, 1).id);
        const page = yield* setup.list(feedItemQuery({ cursor }));

        expect(idsOf(page)).toEqual([rowAt(setup.rows, 0).id]);
      }).pipe(Effect.provide(makeLayer()))
    );
  };

const unreadCases =
  (makeLayer: FeedStoreFactory, scope: ListScopeSetup) => (): void => {
    it.effect('CM-PAGE-8 returns unread rows only while unread is true', () =>
      Effect.gen(function* () {
        const setup = yield* seedRows(scope, 3, (index) => ({
          read: index !== 1,
        }));

        const unread = yield* setup.list(
          feedItemQuery({ limit: 1, unread: true })
        );
        const all = yield* setup.list(feedItemQuery({ unread: false }));

        expect(idsOf(unread)).toEqual([rowAt(setup.rows, 1).id]);
        expect(idsOf(all)).toEqual(idsOf(setup.rows).reverse());
      }).pipe(Effect.provide(makeLayer()))
    );
  };

const deletedCursorCases =
  (makeLayer: FeedStoreFactory, scope: ListScopeSetup) => (): void => {
    it.effect('CM-PAGE-6 keeps paging after the cursor row was removed', () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const setup = yield* seedRows(scope, 3, () => ({}));
        const cursor = rowAt(setup.rows, 1).id;
        yield* items.remove(alice, [cursor]);

        const page = yield* setup.list(
          feedItemQuery({ cursor: optionOf(cursor) })
        );

        expect(idsOf(page)).toEqual([rowAt(setup.rows, 0).id]);
      }).pipe(Effect.provide(makeLayer()))
    );
  };

const everyRowCases =
  (makeLayer: FeedStoreFactory, scope: ListScopeSetup) => (): void => {
    it.effect('CM-PAGE-10 pages through every row once', () =>
      Effect.gen(function* () {
        const setup = yield* seedRows(scope, 5, () => ({}));
        const first = yield* setup.list(feedItemQuery({ limit: 2 }));
        const second = yield* setup.list(
          feedItemQuery({ limit: 2, cursor: optionOf(rowAt(first, 1).id) })
        );
        const third = yield* setup.list(
          feedItemQuery({ limit: 2, cursor: optionOf(rowAt(second, 1).id) })
        );

        expect(idsOf([...first, ...second, ...third])).toEqual(
          idsOf(setup.rows).reverse()
        );
      }).pipe(Effect.provide(makeLayer()))
    );
  };

export const listCases = (
  makeLayer: FeedStoreFactory,
  scope: ListScopeSetup
): void => {
  describe('order and limit', orderCases(makeLayer, scope));
  describe('cursor', cursorCases(makeLayer, scope));
  describe('unread', unreadCases(makeLayer, scope));
  describe('deleted cursor', deletedCursorCases(makeLayer, scope));
  describe('every row', everyRowCases(makeLayer, scope));
};
