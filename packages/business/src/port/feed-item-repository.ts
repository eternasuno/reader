import { Context, Data, type Effect, type Option } from 'effect';
import type { ArticleContent } from '../entity/common/article';
import type { OwnerId } from '../entity/common/owner-id';
import type { FeedId } from '../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../entity/feed/feed-item';
import type { FolderId } from '../entity/feed/folder';

export class FeedItemRepositoryError extends Data.TaggedError(
  'FeedItemRepositoryError'
)<{ readonly message: string }> {}

export type FeedItemQuery = {
  readonly unreadOnly: boolean;
  readonly after?: FeedItemId;
  readonly limit: number;
};

export type FeedItemKey = Pick<FeedItem, 'id' | 'url'>;

export type FeedUnreadCount = {
  readonly feedId: FeedId;
  readonly count: number;
};

/**
 * All methods are scoped by `ownerId`. Write semantics are those of CM-PORT.
 */
export interface IFeedItemRepository {
  /** `Option` of the item. */
  readonly find: (
    owner: OwnerId,
    id: FeedItemId
  ) => Effect.Effect<Option.Option<FeedItem>, FeedItemRepositoryError>;
  /**
   * The owner's items ordered by `id` descending (FD-LIST-4); strictly after
   * the cursor position when given; unread only when `unreadOnly`; at most
   * `limit`.
   */
  readonly listAll: (
    owner: OwnerId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * As `listAll`, restricted to the items of that feed of the owner
   * (FD-LIST-2).
   */
  readonly listByFeed: (
    owner: OwnerId,
    feedId: FeedId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * As `listAll`, restricted to the items of the owner's feeds whose
   * `folderId` is that folder when the query runs (FD-LIST-6, FD-LIST-7).
   */
  readonly listByFolder: (
    owner: OwnerId,
    folderId: FolderId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT). Items of a missing feed are
   * skipped; the feed-exists check and the insert are one atomic write, so an
   * item is never left without its feed when `FeedRepository.remove` runs
   * concurrently.
   */
  readonly create: (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  /**
   * Sets `read` on the owner's items among `ids`; unknown and foreign ids
   * ignored, an empty list changes nothing (FD-READ-1).
   */
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    read: boolean
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /**
   * Sets `read = true` on every item of the owner's feeds among `feedIds`
   * (FD-READ-2).
   */
  readonly markReadByFeeds: (
    owner: OwnerId,
    feedIds: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /**
   * Sets `read = true` on every item of the owner's feeds whose folder is
   * among `folderIds` when the call runs (FD-READ-5).
   */
  readonly markReadByFolders: (
    owner: OwnerId,
    folderIds: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /** Sets `read = true` on every item of the owner. */
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /**
   * Sets the item's `extractedContent` and returns `true`; returns `false` and
   * writes nothing when the item is not the owner's (FD-EXTRACT step 4).
   */
  readonly setExtractedContent: (
    owner: OwnerId,
    id: FeedItemId,
    content: ArticleContent
  ) => Effect.Effect<boolean, FeedItemRepositoryError>;
  /** Unread count per feed of the owner. */
  readonly unreadCounts: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<FeedUnreadCount>, FeedItemRepositoryError>;
  /**
   * `(id, url)` of every stored item of the feed, ordered by `id` descending.
   */
  readonly inventory: (
    owner: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<ReadonlyArray<FeedItemKey>, FeedItemRepositoryError>;
  /** Deletes the owner's items among `ids`; unknown ids ignored. */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
}

export class FeedItemRepository extends Context.Service<
  FeedItemRepository,
  IFeedItemRepository
>()('@reader/business/FeedItemRepository') {}
