import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { Feed, FeedId } from '../../../../src/entity/feed/feed';
import type { FeedItem } from '../../../../src/entity/feed/feed-item';
import type { FolderId } from '../../../../src/entity/feed/folder';
import {
  type FeedItemQuery,
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../../src/port/feed-item-repository';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../../../src/port/feed-repository';
import type {
  FolderRepository,
  FolderRepositoryError,
} from '../../../../src/port/folder-repository';
import {
  alice,
  bob,
  idsOf,
  makeUniqueFeed,
  makeUniqueFeedItem,
  rowAt,
  storedFeed,
  storedFolder,
} from '../../fixtures';
import type { FeedStoreLayer } from '../feed';
import {
  allFolderCases,
  feedEmptyCases,
  feedExclusionCases,
  folderEmptyCases,
  folderExclusionCases,
  folderMergeCases,
  folderMovedOutCases,
} from './list-scope';

type Lister = (
  query: FeedItemQuery
) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;

type ScopeError =
  | FeedItemRepositoryError
  | FeedRepositoryError
  | FolderRepositoryError;

export type ListScope = (
  makeRows: (feedId: FeedId) => ReadonlyArray<FeedItem>
) => Effect.Effect<
  {
    readonly feed: Feed;
    readonly rows: ReadonlyArray<FeedItem>;
    readonly list: Lister;
  },
  ScopeError,
  FeedRepository | FeedItemRepository | FolderRepository
>;

const foreignRow = (): Effect.Effect<
  void,
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const feed = yield* storedFeed(bob);
    yield* items.create(bob, [
      makeUniqueFeedItem({ feedId: feed.id, ownerId: bob }),
    ]);
  });

const scopeFeed = (
  folderId: Option.Option<FolderId>
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ ownerId: alice, folderId });
    yield* feeds.create(alice, [feed]);

    return feed;
  });

const seedRows = (
  feed: Feed,
  makeRows: (feedId: FeedId) => ReadonlyArray<FeedItem>
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const rows = makeRows(feed.id);
    yield* items.create(alice, rows);

    return rows;
  });

const listAllScope: ListScope = (makeRows) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const feed = yield* scopeFeed(Option.none());
    const rows = yield* seedRows(feed, makeRows);
    yield* foreignRow();

    return { feed, list: (asked) => items.listAll(alice, asked), rows };
  });

const listByFeedScope: ListScope = (makeRows) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const feed = yield* scopeFeed(Option.none());
    const rows = yield* seedRows(feed, makeRows);
    yield* foreignRow();

    return {
      feed,
      list: (asked) => items.listByFeed(alice, feed.id, asked),
      rows,
    };
  });

const listByFolderScope: ListScope = (makeRows) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const folder = yield* storedFolder();
    const feed = yield* scopeFeed(Option.some(folder.id));
    const rows = yield* seedRows(feed, makeRows);
    yield* foreignRow();

    return {
      feed,
      list: (asked) => items.listByFolder(alice, folder.id, asked),
      rows,
    };
  });

const orderCases = (layer: FeedStoreLayer, scope: ListScope) => (): void => {
  it.effect('lists the owner items newest first at most limit', () =>
    Effect.gen(function* () {
      const setup = yield* scope((feedId) => [
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
      ]);
      const page = yield* setup.list({ limit: 2, unreadOnly: false });

      expect(idsOf(page)).toEqual([
        rowAt(setup.rows, 2).id,
        rowAt(setup.rows, 1).id,
      ]);
    }).pipe(Effect.provide(layer))
  );
};

const unreadCases = (layer: FeedStoreLayer, scope: ListScope) => (): void => {
  it.effect('returns unread items only', () =>
    Effect.gen(function* () {
      const setup = yield* scope((feedId) => [
        makeUniqueFeedItem({ feedId, read: true }),
        makeUniqueFeedItem({ feedId }),
      ]);
      const listed = yield* setup.list({ limit: 10, unreadOnly: true });

      expect(idsOf(listed)).toEqual([rowAt(setup.rows, 1).id]);
    }).pipe(Effect.provide(layer))
  );
};

const deletedCursorCases =
  (layer: FeedStoreLayer, scope: ListScope) => (): void => {
    it.effect('keeps paging after the cursor row was removed', () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const setup = yield* scope((feedId) => [
          makeUniqueFeedItem({ feedId }),
          makeUniqueFeedItem({ feedId }),
          makeUniqueFeedItem({ feedId }),
        ]);
        const cursor = rowAt(setup.rows, 1);
        yield* items.remove(alice, [cursor.id]);
        const afterRemoved = yield* setup.list({
          after: cursor.id,
          limit: 10,
          unreadOnly: false,
        });

        expect(idsOf(afterRemoved)).toEqual([rowAt(setup.rows, 0).id]);
      }).pipe(Effect.provide(layer))
    );
  };

const everyRowCases = (layer: FeedStoreLayer, scope: ListScope) => (): void => {
  it.effect('pages through every row without repeating or skipping', () =>
    Effect.gen(function* () {
      const setup = yield* scope((feedId) => [
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
        makeUniqueFeedItem({ feedId }),
      ]);
      const pageOne = yield* setup.list({ limit: 2, unreadOnly: false });
      const pageTwo = yield* setup.list({
        after: rowAt(setup.rows, 3).id,
        limit: 2,
        unreadOnly: false,
      });
      const pageThree = yield* setup.list({
        after: rowAt(setup.rows, 1).id,
        limit: 2,
        unreadOnly: false,
      });

      expect(idsOf([...pageOne, ...pageTwo, ...pageThree])).toEqual(
        idsOf(setup.rows).reverse()
      );
    }).pipe(Effect.provide(layer))
  );
};

const allCases = (layer: FeedStoreLayer) => (): void => {
  describe('order and limit', orderCases(layer, listAllScope));
  describe('unread', unreadCases(layer, listAllScope));
  describe('deleted cursor', deletedCursorCases(layer, listAllScope));
  describe('every row', everyRowCases(layer, listAllScope));
  describe('folders', allFolderCases(layer));
};

const byFeedCases = (layer: FeedStoreLayer) => (): void => {
  describe('order and limit', orderCases(layer, listByFeedScope));
  describe('unread', unreadCases(layer, listByFeedScope));
  describe('deleted cursor', deletedCursorCases(layer, listByFeedScope));
  describe('every row', everyRowCases(layer, listByFeedScope));
  describe('scope', feedExclusionCases(layer, listByFeedScope));
  describe('empty scope', feedEmptyCases(layer));
};

const byFolderCases = (layer: FeedStoreLayer) => (): void => {
  describe('order and limit', orderCases(layer, listByFolderScope));
  describe('unread', unreadCases(layer, listByFolderScope));
  describe('deleted cursor', deletedCursorCases(layer, listByFolderScope));
  describe('every row', everyRowCases(layer, listByFolderScope));
  describe('merged folders', folderMergeCases(layer));
  describe('scope', folderExclusionCases(layer));
  describe('empty scope', folderEmptyCases(layer));
  describe('feed moved out', folderMovedOutCases(layer));
};

export const listCases = (layer: FeedStoreLayer) => (): void => {
  describe('listAll', allCases(layer));
  describe('listByFeed', byFeedCases(layer));
  describe('listByFolder', byFolderCases(layer));
};
