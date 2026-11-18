import { Context, type Effect, type Option } from 'effect';
import type { NormalizedUrl } from '../entity/common/normalized-url';
import type { OwnerId } from '../entity/common/owner-id';
import type { SavedPage, SavedPageId } from '../entity/saved-page/saved-page';
import type { SavedPageRepositoryError } from '../error/saved-page';

/**
 * Paging of the saved-page list: `id` descending, at most `limit` rows,
 * strictly after `cursor` (CM-PAGE-1, CM-PAGE-3). The list use case asks for
 * `limit + 1` and cuts the last row off (CM-PAGE-4), so the port takes a plain
 * row limit and defines no page size and no upper bound (CM-PAGE-2).
 */
export type SavedPageQuery = {
  readonly limit: number;
  /** `true` returns unread rows only, `false` all rows (CM-PAGE-8). */
  readonly unread: boolean;
  /** None for the first page; a cursor stays valid after its row is deleted (CM-PAGE-6). */
  readonly cursor: Option.Option<SavedPageId>;
};

/**
 * Every method is scoped to the owner passed in (SP-OWN-1, CM-OWN-2); a row of
 * another owner is absent, not an error (CM-OWN-3). Write semantics are those
 * of CM-PORT-3, CM-PORT-5 and CM-PORT-6; every implementation satisfies them
 * (CM-PORT-1).
 */
export interface ISavedPageRepository {
  /** None for a page that does not exist for the owner (SP-OPEN-1, SP-OPEN-2). */
  readonly find: (
    owner: OwnerId,
    id: SavedPageId
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  /**
   * The owner's page with that URL, or none. It is the only lookup by URL
   * (CM-ID-7), and the duplicate is found with it before anything is fetched
   * (SP-ID-4, SP-ADD step 1, SP-SAVE step 2).
   */
  readonly findByUrl: (
    owner: OwnerId,
    url: NormalizedUrl
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  /** The owner's pages, newest first (SP-LIST-1, SP-LIST-2). */
  readonly list: (
    owner: OwnerId,
    query: SavedPageQuery
  ) => Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT-6). A row is skipped, never
   * overwritten, when its id exists, when the owner already saved its URL
   * (CM-ID-6, SP-ID-2), or when its `ownerId` differs from `owner`; of two
   * concurrent creates of one URL exactly one succeeds (SP-ADD-5).
   */
  readonly create: (
    owner: OwnerId,
    pages: ReadonlyArray<SavedPage>
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  /** Sets `read` on the owner's pages among `ids`; unknown and foreign ids are ignored (SP-READ-1) and marking is idempotent (SP-READ-2). */
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    read: boolean
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /** Sets `read = true` on every page of the owner, loaded or not (SP-READ). */
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /** Removes the owner's pages among `ids`; unknown and foreign ids are ignored (SP-REMOVE-1) and an empty list changes nothing. */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  /** The number of the owner's unread pages (SP-COUNT-1). */
  readonly unreadCount: (
    owner: OwnerId
  ) => Effect.Effect<number, SavedPageRepositoryError>;
}

export class SavedPageRepository extends Context.Service<
  SavedPageRepository,
  ISavedPageRepository
>()('@reader/business/SavedPageRepository') {}
