import { Effect, Option, Ref } from 'effect';
import type { ArticleContent } from '../../../../src/entity/common/article';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type { Feed, FeedId } from '../../../../src/entity/feed/feed';
import type {
  FeedItem,
  FeedItemId,
} from '../../../../src/entity/feed/feed-item';
import type { FolderId } from '../../../../src/entity/feed/folder';
import type {
  FeedItemKey,
  FeedItemQuery,
  FeedUnreadCount,
  IFeedItemRepository,
} from '../../../../src/port/feed-item-repository';
import {
  byIdDescending,
  compareText,
  type MemoryFeedState,
  type Ref_,
} from './state';

const isFeedItemTaken = (
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

const insertFeedItems = (
  feeds: ReadonlyArray<Feed>,
  items: ReadonlyArray<FeedItem>,
  owner: OwnerId,
  rows: ReadonlyArray<FeedItem>
) => {
  const stored: Array<FeedItem> = [...items];
  const created: Array<FeedItemId> = [];

  for (const row of rows) {
    if (isFeedItemTaken(feeds, stored, owner, row)) {
      continue;
    }

    stored.push(row);
    created.push(row.id);
  }

  return { items: stored, created };
};

const markFeedItems =
  (state: Ref_) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    read: boolean
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);

      return {
        ...store,
        items: store.items.map((item) =>
          item.ownerId === owner && wanted.has(item.id)
            ? { ...item, read }
            : item
        ),
      };
    });

const markFeedItemsByFeeds =
  (state: Ref_) =>
  (owner: OwnerId, feedIds: ReadonlyArray<FeedId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(feedIds);

      return {
        ...store,
        items: store.items.map((item) =>
          item.ownerId === owner && wanted.has(item.feedId)
            ? { ...item, read: true }
            : item
        ),
      };
    });

const markFeedItemsByFolders =
  (state: Ref_) =>
  (owner: OwnerId, folderIds: ReadonlyArray<FolderId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(folderIds);
      const feedIds = new Set<string>(
        store.feeds
          .filter(
            (feed) =>
              feed.ownerId === owner &&
              Option.exists(feed.folderId, (id) => wanted.has(id))
          )
          .map((feed) => feed.id)
      );

      return {
        ...store,
        items: store.items.map((item) =>
          item.ownerId === owner && feedIds.has(item.feedId)
            ? { ...item, read: true }
            : item
        ),
      };
    });

const markAllFeedItems =
  (state: Ref_) =>
  (owner: OwnerId): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      ...store,
      items: store.items.map((item) =>
        item.ownerId === owner ? { ...item, read: true } : item
      ),
    }));

const setExtractedContent =
  (state: Ref_) =>
  (
    owner: OwnerId,
    id: FeedItemId,
    content: ArticleContent
  ): Effect.Effect<boolean> =>
    Ref.modify(state, (store) => {
      let found = false;
      const items = store.items.map((item) => {
        if (item.ownerId !== owner || item.id !== id) {
          return item;
        }

        found = true;

        return { ...item, extractedContent: Option.some(content) };
      });

      return [found, { ...store, items }];
    });

const findFeedItem =
  (state: Ref_) =>
  (owner: OwnerId, id: FeedItemId): Effect.Effect<Option.Option<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.items.find((item) => item.ownerId === owner && item.id === id)
      )
    );

const filterFeedItems = (
  store: MemoryFeedState,
  owner: OwnerId,
  scope: (item: FeedItem) => boolean,
  query: FeedItemQuery
): ReadonlyArray<FeedItem> =>
  store.items
    .filter((item) => item.ownerId === owner)
    .filter(scope)
    .filter((item) => !query.unreadOnly || !item.read)
    .filter((item) => query.after === undefined || item.id < query.after)
    .sort(byIdDescending)
    .slice(0, query.limit);

const listAllFeedItems =
  (state: Ref_) =>
  (
    owner: OwnerId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      filterFeedItems(store, owner, () => true, query)
    );

const listFeedItemsByFeed =
  (state: Ref_) =>
  (
    owner: OwnerId,
    feedId: FeedId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      filterFeedItems(store, owner, (item) => item.feedId === feedId, query)
    );

const listFeedItemsByFolder =
  (state: Ref_) =>
  (
    owner: OwnerId,
    folderId: FolderId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) => {
      const feedIds = new Set<string>(
        store.feeds
          .filter(
            (feed) =>
              feed.ownerId === owner &&
              Option.getOrUndefined(feed.folderId) === folderId
          )
          .map((feed) => feed.id)
      );

      return filterFeedItems(
        store,
        owner,
        (item) => feedIds.has(item.feedId),
        query
      );
    });

const createFeedItems =
  (state: Ref_) =>
  (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ): Effect.Effect<ReadonlyArray<FeedItemId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertFeedItems(store.feeds, store.items, owner, items);

      return [inserted.created, { ...store, items: inserted.items }];
    });

const unreadFeedCounts =
  (state: Ref_) =>
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
  (state: Ref_) =>
  (owner: OwnerId, feedId: FeedId): Effect.Effect<ReadonlyArray<FeedItemKey>> =>
    Effect.map(Ref.get(state), (store) =>
      store.items
        .filter((item) => item.ownerId === owner && item.feedId === feedId)
        .sort(byIdDescending)
        .map((item): FeedItemKey => ({ id: item.id, url: item.url }))
    );

const removeFeedItems =
  (state: Ref_) =>
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
  state: Ref_
): IFeedItemRepository => ({
  find: findFeedItem(state),
  listAll: listAllFeedItems(state),
  listByFeed: listFeedItemsByFeed(state),
  listByFolder: listFeedItemsByFolder(state),
  create: createFeedItems(state),
  markRead: markFeedItems(state),
  markReadByFeeds: markFeedItemsByFeeds(state),
  markReadByFolders: markFeedItemsByFolders(state),
  markAllRead: markAllFeedItems(state),
  setExtractedContent: setExtractedContent(state),
  unreadCounts: unreadFeedCounts(state),
  inventory: feedInventory(state),
  remove: removeFeedItems(state),
});
