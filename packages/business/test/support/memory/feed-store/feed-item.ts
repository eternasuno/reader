import { Effect, Option, Ref } from 'effect';
import type { ArticleContent } from '../../../../src/entity/common/article';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type { Feed, FeedId, FeedOrder } from '../../../../src/entity/feed/feed';
import type {
  FeedItem,
  FeedItemId,
} from '../../../../src/entity/feed-item/feed-item';
import type { FolderId } from '../../../../src/entity/folder/folder';
import type {
  FeedItemKey,
  FeedItemQuery,
  FeedUnreadCount,
  IFeedItemRepository,
} from '../../../../src/port/feed-item-repository';
import { byIdDescending, compareText } from '../text';
import { type FeedStateRef, folderFeedIds } from './state';

const isItemTaken = (
  feeds: ReadonlyArray<Feed>,
  items: ReadonlyArray<FeedItem>,
  owner: OwnerId,
  row: FeedItem
): boolean =>
  row.ownerId !== owner ||
  items.some(
    (item) =>
      item.id === row.id ||
      (item.feedId === row.feedId && item.url.href === row.url.href)
  ) ||
  !feeds.some((feed) => feed.id === row.feedId && feed.ownerId === owner);

const insertItems = (
  store: {
    readonly feeds: ReadonlyArray<Feed>;
    readonly items: ReadonlyArray<FeedItem>;
  },
  owner: OwnerId,
  rows: ReadonlyArray<FeedItem>
): {
  readonly items: ReadonlyArray<FeedItem>;
  readonly created: ReadonlyArray<FeedItemId>;
} => {
  const stored: Array<FeedItem> = [...store.items];
  const created: Array<FeedItemId> = [];

  for (const row of rows) {
    if (!isItemTaken(store.feeds, stored, owner, row)) {
      stored.push(row);
      created.push(row.id);
    }
  }

  return { items: stored, created };
};

const findItem =
  (state: FeedStateRef) =>
  (owner: OwnerId, id: FeedItemId): Effect.Effect<Option.Option<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.items.find((item) => item.ownerId === owner && item.id === id)
      )
    );

/**
 * One page: owner, scope, unread filter, strictly after the cursor, id
 * descending, or ascending under `oldest` (CM-PAGE, FD-PREF-3).
 */
const page = (
  store: { readonly items: ReadonlyArray<FeedItem> },
  owner: OwnerId,
  inScope: (item: FeedItem) => boolean,
  query: FeedItemQuery,
  order: FeedOrder = 'newest'
): ReadonlyArray<FeedItem> => {
  const isAfter = (item: FeedItem, cursor: FeedItemId): boolean =>
    order === 'oldest' ? item.id > cursor : item.id < cursor;
  const rows = store.items
    .filter((item) => item.ownerId === owner && inScope(item))
    .filter((item) => !query.unread || !item.read)
    .filter((item) =>
      Option.match(query.cursor, {
        onNone: () => true,
        onSome: (cursor) => isAfter(item, cursor),
      })
    )
    .sort(byIdDescending);

  return (order === 'oldest' ? rows.reverse() : rows).slice(0, query.limit);
};

const listAllItems =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      page(store, owner, () => true, query)
    );

const listItemsByFeed =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    feedId: FeedId,
    query: FeedItemQuery,
    order: FeedOrder
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      page(store, owner, (item) => item.feedId === feedId, query, order)
    );

const listItemsByFolder =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    folderId: FolderId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) => {
      const feedIds = folderFeedIds(store.folders, store.feeds, owner, [
        folderId,
      ]);

      return page(store, owner, (item) => feedIds.has(item.feedId), query);
    });

const createItems =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ): Effect.Effect<ReadonlyArray<FeedItemId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertItems(store, owner, items);

      return [inserted.created, { ...store, items: inserted.items }];
    });

const markItems = (
  store: { readonly items: ReadonlyArray<FeedItem> },
  inScope: (item: FeedItem) => boolean,
  read: boolean
): ReadonlyArray<FeedItem> =>
  store.items.map((item) => (inScope(item) ? { ...item, read } : item));

const markReadItems =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    read: boolean
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);

      return {
        ...store,
        items: markItems(
          store,
          (item) => item.ownerId === owner && wanted.has(item.id),
          read
        ),
      };
    });

const markReadItemsByFeeds =
  (state: FeedStateRef) =>
  (owner: OwnerId, feedIds: ReadonlyArray<FeedId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(feedIds);

      return {
        ...store,
        items: markItems(
          store,
          (item) => item.ownerId === owner && wanted.has(item.feedId),
          true
        ),
      };
    });

const markReadItemsByFolders =
  (state: FeedStateRef) =>
  (owner: OwnerId, folderIds: ReadonlyArray<FolderId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const feedIds = folderFeedIds(
        store.folders,
        store.feeds,
        owner,
        folderIds
      );

      return {
        ...store,
        items: markItems(
          store,
          (item) => item.ownerId === owner && feedIds.has(item.feedId),
          true
        ),
      };
    });

const markAllItemsRead =
  (state: FeedStateRef) =>
  (owner: OwnerId): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      ...store,
      items: markItems(store, (item) => item.ownerId === owner, true),
    }));

const setItemExtractedContent =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    id: FeedItemId,
    content: ArticleContent
  ): Effect.Effect<boolean> =>
    Ref.modify(state, (store) => {
      const found = store.items.some(
        (item) => item.ownerId === owner && item.id === id
      );

      return [
        found,
        {
          ...store,
          items: store.items.map((item) =>
            item.ownerId === owner && item.id === id
              ? { ...item, extractedContent: Option.some(content) }
              : item
          ),
        },
      ];
    });

const countUnreadItems =
  (state: FeedStateRef) =>
  (owner: OwnerId): Effect.Effect<ReadonlyArray<FeedUnreadCount>> =>
    Effect.map(Ref.get(state), (store) => {
      const counts = new Map<FeedId, number>();

      for (const item of store.items) {
        if (item.ownerId === owner && !item.read) {
          counts.set(item.feedId, (counts.get(item.feedId) ?? 0) + 1);
        }
      }

      return Array.from(counts, ([feedId, count]) => ({ feedId, count })).sort(
        (left, right) => compareText(left.feedId, right.feedId)
      );
    });

const feedInventory =
  (state: FeedStateRef) =>
  (owner: OwnerId, feedId: FeedId): Effect.Effect<ReadonlyArray<FeedItemKey>> =>
    Effect.map(Ref.get(state), (store) =>
      store.items
        .filter((item) => item.ownerId === owner && item.feedId === feedId)
        .sort(byIdDescending)
        .map((item): FeedItemKey => ({ id: item.id, url: item.url }))
    );

const removeItems =
  (state: FeedStateRef) =>
  (owner: OwnerId, ids: ReadonlyArray<FeedItemId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);

      return {
        ...store,
        items: store.items.filter(
          (item) => item.ownerId !== owner || !wanted.has(item.id)
        ),
      };
    });

export const makeMemoryFeedItemRepository = (
  state: FeedStateRef
): IFeedItemRepository => ({
  find: findItem(state),
  listAll: listAllItems(state),
  listByFeed: listItemsByFeed(state),
  listByFolder: listItemsByFolder(state),
  create: createItems(state),
  markRead: markReadItems(state),
  markReadByFeeds: markReadItemsByFeeds(state),
  markReadByFolders: markReadItemsByFolders(state),
  markAllRead: markAllItemsRead(state),
  setExtractedContent: setItemExtractedContent(state),
  unreadCounts: countUnreadItems(state),
  inventory: feedInventory(state),
  remove: removeItems(state),
});
