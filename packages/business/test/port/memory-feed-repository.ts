import { Effect, Option, Ref } from 'effect';
import type { OwnerId } from '../../src/entity/common/owner-id';
import type { Feed, FeedId } from '../../src/entity/feed/feed';
import type { Folder, FolderId } from '../../src/entity/feed/folder';
import type {
  FeedPatch,
  IFeedRepository,
} from '../../src/port/feed-repository';
import { byTitleThenId, type Ref_ } from './memory-feed-state';

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

const patchFeed = (feed: Feed, patch: FeedPatch): Feed => ({
  ...feed,
  title: patch.title ?? feed.title,
  folderId: patch.folderId ?? feed.folderId,
  updatedAt: patch.updatedAt ?? feed.updatedAt,
});

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

const updateFeeds =
  (state: Ref_) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<FeedId>,
    patch: FeedPatch
  ): Effect.Effect<ReadonlyArray<FeedId>> =>
    Ref.modify(state, (store) => {
      const matched: Array<FeedId> = [];

      if (
        patch.folderId !== undefined &&
        isFolderMissing(store.folders, owner, patch.folderId)
      ) {
        return [matched, store];
      }

      const wanted = new Set<string>(ids);
      const feeds = store.feeds.map((feed) => {
        if (feed.ownerId !== owner || !wanted.has(feed.id)) {
          return feed;
        }

        matched.push(feed.id);

        return patchFeed(feed, patch);
      });

      return [matched, { ...store, feeds }];
    });

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
  update: updateFeeds(state),
  remove: removeFeeds(state),
});
