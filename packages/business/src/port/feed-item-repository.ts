import { Context, type Effect, type Option } from 'effect';
import type { ArticleContent } from '../entity/common/article';
import type { OwnerId } from '../entity/common/owner-id';
import type { FeedId, FeedOrder } from '../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../entity/feed-item/feed-item';
import type { FolderId } from '../entity/folder/folder';
import type { FeedItemRepositoryError } from '../error/feed-item';

/**
 * Paging of every feed-item list: `id` descending, at most `limit` rows,
 * strictly after `cursor` (CM-PAGE-1, CM-PAGE-3). The list use case asks for
 * `limit + 1` and cuts the last row off (CM-PAGE-4), so the port takes a plain
 * row limit and defines no page size and no upper bound (CM-PAGE-2).
 */
export type FeedItemQuery = {
  readonly limit: number;
  /** `true` returns unread rows only, `false` all rows (CM-PAGE-8). */
  readonly unread: boolean;
  /** None for the first page; a cursor stays valid after its row is deleted (CM-PAGE-6). */
  readonly cursor: Option.Option<FeedItemId>;
};

/** The inventory of one feed: the `id` and `url` of each stored item (FD-SEL-8). */
export type FeedItemKey = Pick<FeedItem, 'id' | 'url'>;

/** The number of unread items of one feed; a feed with none may be absent (FD-COUNT-1). */
export type FeedUnreadCount = {
  readonly feedId: FeedId;
  readonly count: number;
};

/**
 * Every method is scoped to the owner passed in (CM-OWN-2); a row of another
 * owner is absent, not an error (CM-OWN-3). Write semantics are those of
 * CM-PORT-3, CM-PORT-5 and CM-PORT-6; every implementation satisfies them
 * (CM-PORT-1).
 */
export interface IFeedItemRepository {
  /** None for an item that does not exist for the owner (FD-OPEN-1, FD-OPEN-2). */
  readonly find: (
    owner: OwnerId,
    id: FeedItemId
  ) => Effect.Effect<Option.Option<FeedItem>, FeedItemRepositoryError>;
  /** The items of all the owner's feeds, one page (FD-LIST-1). */
  readonly listAll: (
    owner: OwnerId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * As `listAll`, restricted to one feed; an unknown or foreign feed gives an
   * empty page (FD-LIST-2). Under `oldest` the rows are `id` ascending and the
   * cursor means strictly larger ids (FD-PREF-3).
   */
  readonly listByFeed: (
    owner: OwnerId,
    feedId: FeedId,
    query: FeedItemQuery,
    order: FeedOrder
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * As `listAll`, restricted to the items of the feeds whose `folderId` is that
   * folder when the page is listed (FD-LIST-6); an unknown or foreign folder and
   * an empty folder give an empty page (FD-LIST-7).
   */
  readonly listByFolder: (
    owner: OwnerId,
    folderId: FolderId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT-6). A row is skipped, never
   * overwritten, when its id exists, when the feed already has an item with its
   * URL (CM-ID-6, FD-ID-2), when its `ownerId` differs from `owner`, or when
   * its feed does not exist for the owner; the feed check and the insert are
   * one atomic statement, so a sync leaves no items behind for a feed removed
   * while it runs (FD-SYNC-5).
   */
  readonly create: (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  /** Sets `read` on the owner's items among `ids`; unknown and foreign ids are ignored (FD-READ-1) and marking is idempotent (FD-READ-4). */
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    read: boolean
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /** Sets `read = true` on every item of the owner's feeds among `feedIds` (FD-READ-2). */
  readonly markReadByFeeds: (
    owner: OwnerId,
    feedIds: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /**
   * Sets `read = true` on every item of the owner's feeds that are in the given
   * folders when the call runs; a feed that left the folder is unchanged
   * (FD-READ-5).
   */
  readonly markReadByFolders: (
    owner: OwnerId,
    folderIds: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /** Sets `read = true` on every item of every feed of the owner (FD-READ, SP-READ-3). */
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  /**
   * Sets the item's `extractedContent` and returns `true`; returns `false` and
   * writes nothing when the item is not the owner's, so a vanished item is told
   * apart from a stored one (CM-PORT-5, FD-EXTRACT step 4). Stored items are
   * otherwise never modified (FD-SYNC-1).
   */
  readonly setExtractedContent: (
    owner: OwnerId,
    id: FeedItemId,
    content: ArticleContent
  ) => Effect.Effect<boolean, FeedItemRepositoryError>;
  /** The unread count per feed of the owner (FD-COUNT-1); the total and a folder's count are computed by the caller (FD-COUNT-2, FD-COUNT-3). */
  readonly unreadCounts: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<FeedUnreadCount>, FeedItemRepositoryError>;
  /** The `(id, url)` of every stored item of one feed, in list order (FD-SYNC step 1, FD-SEL-8). */
  readonly inventory: (
    owner: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<ReadonlyArray<FeedItemKey>, FeedItemRepositoryError>;
  /**
   * Removes the owner's items among `ids` (FD-SYNC step 4); unknown and foreign
   * ids are ignored and an empty list changes nothing.
   */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
}

export class FeedItemRepository extends Context.Service<
  FeedItemRepository,
  IFeedItemRepository
>()('@reader/business/FeedItemRepository') {}
