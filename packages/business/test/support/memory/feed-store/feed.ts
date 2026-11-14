import { type DateTime, Effect, Option, Ref } from 'effect';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type { Feed, FeedId, FeedTitle } from '../../../../src/entity/feed/feed';
import type { Folder, FolderId } from '../../../../src/entity/feed/folder';
import type { IFeedRepository } from '../../../../src/port/feed-repository';
import { byTitleThenId, type Ref_ } from './state';

const hasFolder = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  id: FolderId
): boolean =>
  folders.some((folder) => folder.ownerId === owner && folder.id === id);

const isFolderMissing = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  folderId: Option.Option<FolderId>
): boolean => Option.exists(folderId, (id) => !hasFolder(folders, owner, id));

const isFeedTaken = (
  feeds: ReadonlyArray<Feed>,
  folders: ReadonlyArray<Folder>,
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
  feeds: ReadonlyArray<Feed>,
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  rows: ReadonlyArray<Feed>
) => {
  const stored: Array<Feed> = [...feeds];
  const created: Array<FeedId> = [];

  for (const row of rows) {
    if (isFeedTaken(stored, folders, owner, row)) {
      continue;
    }

    stored.push(row);
    created.push(row.id);
  }

  return { feeds: stored, created };
};

const findFeed =
  (state: Ref_) =>
  (owner: OwnerId, id: FeedId): Effect.Effect<Option.Option<Feed>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.feeds.find((feed) => feed.ownerId === owner && feed.id === id)
      )
    );

const listFeeds =
  (state: Ref_) =>
  (owner: OwnerId): Effect.Effect<ReadonlyArray<Feed>> =>
    Effect.map(Ref.get(state), (store) =>
      store.feeds.filter((feed) => feed.ownerId === owner).sort(byTitleThenId)
    );

const createFeeds =
  (state: Ref_) =>
  (
    owner: OwnerId,
    feeds: ReadonlyArray<Feed>
  ): Effect.Effect<ReadonlyArray<FeedId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertFeeds(store.feeds, store.folders, owner, feeds);

      return [inserted.created, { ...store, feeds: inserted.feeds }];
    });

const moveFeedToFolder =
  (state: Ref_) =>
  (
    owner: OwnerId,
    id: FeedId,
    folderId: Option.Option<FolderId>
  ): Effect.Effect<boolean> =>
    Ref.modify(state, (store) => {
      if (isFolderMissing(store.folders, owner, folderId)) {
        return [false, store];
      }

      const feed = store.feeds.find(
        (row) => row.ownerId === owner && row.id === id
      );

      if (feed === undefined) {
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
  (state: Ref_) =>
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

const removeFeeds =
  (state: Ref_) =>
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

export const makeMemoryFeedRepository = (state: Ref_): IFeedRepository => ({
  find: findFeed(state),
  list: listFeeds(state),
  create: createFeeds(state),
  moveToFolder: moveFeedToFolder(state),
  recordSync: recordFeedSync(state),
  remove: removeFeeds(state),
});
