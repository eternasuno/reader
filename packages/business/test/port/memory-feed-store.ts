import { Effect, Layer, Option, Ref } from 'effect';
import type { OwnerId } from '../../src/entity/common/owner-id';
import type { Feed, FeedId } from '../../src/entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../src/entity/feed/feed-item';
import {
  type FeedItemKey,
  type FeedItemPatch,
  type FeedItemQuery,
  FeedItemRepository,
  type FeedUnreadCount,
  type IFeedItemRepository,
} from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { makeMemoryFeedRepository } from './memory-feed-repository';
import {
  byIdDescending,
  compareText,
  type MemoryFeedState,
  type Ref_,
} from './memory-feed-state';

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

const patchFeedItem = (item: FeedItem, patch: FeedItemPatch): FeedItem => ({
  ...item,
  read: patch.read ?? item.read,
  extractedContent: patch.extractedContent ?? item.extractedContent,
});

const findFeedItem =
  (state: Ref_) =>
  (owner: OwnerId, id: FeedItemId): Effect.Effect<Option.Option<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.items.find((item) => item.ownerId === owner && item.id === id)
      )
    );

const listFeedItems =
  (state: Ref_) =>
  (
    owner: OwnerId,
    query: FeedItemQuery
  ): Effect.Effect<ReadonlyArray<FeedItem>> =>
    Effect.map(Ref.get(state), (store) =>
      store.items
        .filter((item) => item.ownerId === owner)
        .filter(
          (item) => query.feedId === undefined || item.feedId === query.feedId
        )
        .filter((item) => !query.unreadOnly || !item.read)
        .filter((item) => query.after === undefined || item.id < query.after)
        .sort(byIdDescending)
        .slice(0, query.limit)
    );

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

const updateFeedItems =
  (state: Ref_) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    patch: FeedItemPatch
  ): Effect.Effect<ReadonlyArray<FeedItemId>> =>
    Ref.modify(state, (store) => {
      const wanted = new Set<string>(ids);
      const matched: Array<FeedItemId> = [];
      const items = store.items.map((item) => {
        if (item.ownerId !== owner || !wanted.has(item.id)) {
          return item;
        }

        matched.push(item.id);

        return patchFeedItem(item, patch);
      });

      return [matched, { ...store, items }];
    });

const updateFeedItemsByFeeds =
  (state: Ref_) =>
  (
    owner: OwnerId,
    feedIds: ReadonlyArray<FeedId>,
    patch: FeedItemPatch
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(feedIds);

      return {
        ...store,
        items: store.items.map((item) =>
          item.ownerId === owner && wanted.has(item.feedId)
            ? patchFeedItem(item, patch)
            : item
        ),
      };
    });

const updateAllFeedItems =
  (state: Ref_) =>
  (owner: OwnerId, patch: FeedItemPatch): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      ...store,
      items: store.items.map((item) =>
        item.ownerId === owner ? patchFeedItem(item, patch) : item
      ),
    }));

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

const makeMemoryFeedItemRepository = (state: Ref_): IFeedItemRepository => ({
  find: findFeedItem(state),
  list: listFeedItems(state),
  create: createFeedItems(state),
  update: updateFeedItems(state),
  updateByFeeds: updateFeedItemsByFeeds(state),
  updateAll: updateAllFeedItems(state),
  unreadCounts: unreadFeedCounts(state),
  inventory: feedInventory(state),
  remove: removeFeedItems(state),
});

export const memoryFeedStoreLayer = (
  decorateItems: (items: IFeedItemRepository) => IFeedItemRepository = (
    items
  ) => items
): Layer.Layer<FeedRepository | FeedItemRepository> =>
  Layer.unwrap(
    Effect.map(Ref.make<MemoryFeedState>({ feeds: [], items: [] }), (state) =>
      Layer.mergeAll(
        Layer.succeed(FeedRepository, makeMemoryFeedRepository(state)),
        Layer.succeed(
          FeedItemRepository,
          decorateItems(makeMemoryFeedItemRepository(state))
        )
      )
    )
  );

export const MemoryFeedStoreLive: Layer.Layer<
  FeedRepository | FeedItemRepository
> = memoryFeedStoreLayer();
