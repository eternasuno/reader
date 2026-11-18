import { Context, type DateTime, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type {
  Feed,
  FeedId,
  FeedOrder,
  FeedReaderMode,
  FeedTitle,
} from '../entity/feed/feed';
import type { FolderId } from '../entity/folder/folder';
import type { FeedRepositoryError } from '../error/feed';

/**
 * Every method is scoped to the owner passed in (CM-OWN-2): a row of another
 * owner is absent, not an error (CM-OWN-3). Write semantics are those of
 * CM-PORT-3, CM-PORT-5 and CM-PORT-6; every implementation, a test double
 * included, satisfies them (CM-PORT-1).
 */
export interface IFeedRepository {
  /** None for a feed that does not exist for the owner (FD-REFRESH step 1, FD-OWN-2). */
  readonly find: (
    owner: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, FeedRepositoryError>;
  /** The owner's feeds ordered by title, then id, compared in UTF-8 byte order (FD-LIST-3). */
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Feed>, FeedRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT-6). A row is skipped, never
   * overwritten, when its id exists, when the owner already follows its URL
   * (CM-ID-6), when its `ownerId` differs from `owner`, or when its `folderId`
   * names a folder that is not the owner's; the folder check and the insert
   * are one atomic write (FD-FOLDER-6), so no feed is ever left pointing at a
   * removed folder.
   */
  readonly create: (
    owner: OwnerId,
    feeds: ReadonlyArray<Feed>
  ) => Effect.Effect<ReadonlyArray<FeedId>, FeedRepositoryError>;
  /**
   * Sets the feed's `folderId`, none being the top level, and returns `true`.
   * Returns `false` and writes nothing when the feed is not the owner's or when
   * `folderId` names a folder that is not the owner's; the folder check and the
   * write are one atomic statement (CM-PORT-5, FD-FOLDER-6, FD-MOVE-3).
   */
  readonly moveToFolder: (
    owner: OwnerId,
    id: FeedId,
    folderId: Option.Option<FolderId>
  ) => Effect.Effect<boolean, FeedRepositoryError>;
  /**
   * Sets the feed's `title` and `updatedAt = some(at)`, the only clock read of
   * a sync (FD-SYNC step 5, CM-TIME-1); returns nothing and changes nothing
   * when the feed is gone (FD-SYNC-5, FD-REFRESH-1).
   */
  readonly recordSync: (
    owner: OwnerId,
    id: FeedId,
    title: FeedTitle,
    at: DateTime.Utc
  ) => Effect.Effect<void, FeedRepositoryError>;
  /**
   * Sets the feed's `readerMode`; changes nothing when the feed is not the
   * owner's (FD-PREF-2).
   */
  readonly setReaderMode: (
    owner: OwnerId,
    id: FeedId,
    readerMode: FeedReaderMode
  ) => Effect.Effect<void, FeedRepositoryError>;
  /** Sets the feed's `order`; changes nothing when the feed is not the owner's (FD-PREF-2). */
  readonly setOrder: (
    owner: OwnerId,
    id: FeedId,
    order: FeedOrder
  ) => Effect.Effect<void, FeedRepositoryError>;
  /**
   * Removes the owner's feeds among `ids` together with all their items in one
   * atomic write (FD-UNSUB-1). Unknown and foreign ids are ignored and an empty
   * list changes nothing (FD-UNSUB-2).
   */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedRepositoryError>;
}

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('@reader/business/FeedRepository') {}
