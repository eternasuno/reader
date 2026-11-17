import { Context, Data, type Effect, type Option } from 'effect';
import type { NormalizedUrl } from '../entity/common/normalized-url';
import type { OwnerId } from '../entity/common/owner-id';
import type { SavedPage, SavedPageId } from '../entity/saved-page/saved-page';

/** A storage failure raised by the `SavedPageRepository` port. */
export class SavedPageRepositoryError extends Data.TaggedError(
  'SavedPageRepositoryError'
)<{ readonly message: string }> {}

export type SavedPageQuery = {
  readonly unreadOnly: boolean;
  readonly after?: SavedPageId;
  readonly limit: number;
};

/**
 * Every method is scoped to the owner passed in (SP-OWN-1, CM-OWN). Write semantics are those of CM-PORT.
 */
export interface ISavedPageRepository {
  /** Returns the page as an `Option`; a missing page, including another owner's, is none (SP-OPEN-1, SP-OPEN-2). */
  readonly find: (
    owner: OwnerId,
    id: SavedPageId
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  /**
   * Returns the owner's page with that URL, or none. It is how a duplicate is found before anything is fetched (SP-ID-4).
   */
  readonly findByUrl: (
    owner: OwnerId,
    url: NormalizedUrl
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  /**
   * Pages ordered by `id` descending, so the newest saved page is on top (SP-LIST-1); those with a smaller id than `after` when given; unread only when `unreadOnly`; at most `limit`.
   */
  readonly list: (
    owner: OwnerId,
    query: SavedPageQuery
  ) => Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError>;
  /**
   * Returns the ids actually created. A row is skipped, never overwritten, when its id exists or its URL is already saved for the owner (CM-PORT-6); two concurrent creates of one URL: exactly one succeeds (SP-ADD-5).
   */
  readonly create: (
    owner: OwnerId,
    pages: ReadonlyArray<SavedPage>
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  /**
   * Sets `read` on the owner's pages among `ids`; unknown and foreign ids ignored, an empty list changes nothing (SP-READ-1).
   */
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    read: boolean
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /** Sets `read = true` on every page of the owner, loaded or not. */
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /**
   * Removes the owner's pages among `ids`; unknown and foreign ids ignored, an empty list changes nothing (SP-REMOVE-1).
   */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /** Count of the owner's unread pages (SP-COUNT-1). */
  readonly unreadCount: (
    owner: OwnerId
  ) => Effect.Effect<number, SavedPageRepositoryError>;
}

export class SavedPageRepository extends Context.Service<
  SavedPageRepository,
  ISavedPageRepository
>()('@reader/business/SavedPageRepository') {}
