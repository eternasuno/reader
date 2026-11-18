import { type DateTime, Effect, Option, Ref } from 'effect';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type { Feed, FeedId, FeedTitle } from '../../../../src/entity/feed/feed';
import type { Folder, FolderId } from '../../../../src/entity/folder/folder';
import type { IFeedRepository } from '../../../../src/port/feed-repository';
import { byTitleThenId, type FeedStateRef, isFolderMissing } from './state';

const isFeedTaken = (
  folders: ReadonlyArray<Folder>,
  feeds: ReadonlyArray<Feed>,
  owner: OwnerId,
  row: Feed
): boolean =>
  row.ownerId !== owner ||
  feeds.some(
    (feed) =>
      feed.id === row.id ||
      (feed.ownerId === row.ownerId && feed.url.href === row.url.href)
  ) ||
  isFolderMissing(folders, owner, row.folderId);

const insertFeeds = (
  store: {
    readonly folders: ReadonlyArray<Folder>;
    readonly feeds: ReadonlyArray<Feed>;
  },
  owner: OwnerId,
  rows: ReadonlyArray<Feed>
): {
  readonly feeds: ReadonlyArray<Feed>;
  readonly created: ReadonlyArray<FeedId>;
} => {
  const stored: Array<Feed> = [...store.feeds];
  const created: Array<FeedId> = [];

  for (const row of rows) {
    if (!isFeedTaken(store.folders, stored, owner, row)) {
      stored.push(row);
      created.push(row.id);
    }
  }

  return { feeds: stored, created };
};

const findFeed =
  (state: FeedStateRef) =>
  (owner: OwnerId, id: FeedId): Effect.Effect<Option.Option<Feed>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.feeds.find((feed) => feed.ownerId === owner && feed.id === id)
      )
    );

const listFeeds =
  (state: FeedStateRef) =>
  (owner: OwnerId): Effect.Effect<ReadonlyArray<Feed>> =>
    Effect.map(Ref.get(state), (store) =>
      store.feeds.filter((feed) => feed.ownerId === owner).sort(byTitleThenId)
    );

const createFeeds =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    feeds: ReadonlyArray<Feed>
  ): Effect.Effect<ReadonlyArray<FeedId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertFeeds(store, owner, feeds);

      return [inserted.created, { ...store, feeds: inserted.feeds }];
    });

const moveFeedToFolder =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    id: FeedId,
    folderId: Option.Option<FolderId>
  ): Effect.Effect<boolean> =>
    Ref.modify(state, (store) => {
      const feed = store.feeds.find(
        (row) => row.ownerId === owner && row.id === id
      );

      if (
        feed === undefined ||
        isFolderMissing(store.folders, owner, folderId)
      ) {
        return [false, store];
      }

      return [
        true,
        {
          ...store,
          feeds: store.feeds.map((row) =>
            row.id === id ? { ...row, folderId } : row
          ),
        },
      ];
    });

const recordFeedSync =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    id: FeedId,
    title: FeedTitle,
    at: DateTime.Utc
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      ...store,
      feeds: store.feeds.map((feed) =>
        feed.ownerId === owner && feed.id === id
          ? { ...feed, title, updatedAt: Option.some(at) }
          : feed
      ),
    }));

const updateFeed =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    id: FeedId,
    change: Partial<Pick<Feed, 'readerMode' | 'order'>>
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      ...store,
      feeds: store.feeds.map((feed) =>
        feed.ownerId === owner && feed.id === id ? { ...feed, ...change } : feed
      ),
    }));

const removeFeeds =
  (state: FeedStateRef) =>
  (owner: OwnerId, ids: ReadonlyArray<FeedId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);
      const removed = new Set<string>(
        store.feeds
          .filter((feed) => feed.ownerId === owner && wanted.has(feed.id))
          .map((feed) => feed.id)
      );

      return {
        ...store,
        feeds: store.feeds.filter((feed) => !removed.has(feed.id)),
        items: store.items.filter((item) => !removed.has(item.feedId)),
      };
    });

export const makeMemoryFeedRepository = (
  state: FeedStateRef
): IFeedRepository => ({
  find: findFeed(state),
  list: listFeeds(state),
  create: createFeeds(state),
  moveToFolder: moveFeedToFolder(state),
  recordSync: recordFeedSync(state),
  setReaderMode: (owner, id, readerMode) =>
    updateFeed(state)(owner, id, { readerMode }),
  setOrder: (owner, id, order) => updateFeed(state)(owner, id, { order }),
  remove: removeFeeds(state),
});
