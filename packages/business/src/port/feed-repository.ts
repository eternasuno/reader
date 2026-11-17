import { Context, Data, type DateTime, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { Feed, FeedId, FeedTitle } from '../entity/feed/feed';
import type { FolderId } from '../entity/feed/folder';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}

/**
 * All methods are scoped by `ownerId`. Write semantics are those of CM-PORT.
 */
export interface IFeedRepository {
  /** `Option` of the feed. */
  readonly find: (
    owner: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, FeedRepositoryError>;
  /** The owner's feeds ordered by title, then id (FD-LIST-3). */
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Feed>, FeedRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT). A row whose `folderId` is a
   * folder that is not the owner's is skipped; the folder check and the insert
   * are one atomic write (FD-FOLDER-6).
   */
  readonly create: (
    owner: OwnerId,
    feeds: ReadonlyArray<Feed>
  ) => Effect.Effect<ReadonlyArray<FeedId>, FeedRepositoryError>;
  /**
   * Sets the feed's `folderId` (`Option`; none is the top level) and returns
   * `true`. Returns `false` and writes nothing when the feed is not the
   * owner's or when `folderId` names a folder that is not the owner's; the
   * folder check and the write are one atomic write (FD-FOLDER-6).
   */
  readonly moveToFolder: (
    owner: OwnerId,
    id: FeedId,
    folderId: Option.Option<FolderId>
  ) => Effect.Effect<boolean, FeedRepositoryError>;
  /**
   * Sets the feed's `title` and `updatedAt = some(at)` (FD-SYNC step 5); an
   * unknown feed changes nothing.
   */
  readonly recordSync: (
    owner: OwnerId,
    id: FeedId,
    title: FeedTitle,
    at: DateTime.Utc
  ) => Effect.Effect<void, FeedRepositoryError>;
  /**
   * Removes the owner's feeds among `ids` **and all their items**; unknown ids
   * ignored.
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
