import { Context, Data, type Effect, type Option } from 'effect';
import type { NormalizedUrl } from '../entity/common/normalized-url';
import type { OwnerId } from '../entity/common/owner-id';
import type { SavedPage, SavedPageId } from '../entity/saved-page/saved-page';

export class SavedPageRepositoryError extends Data.TaggedError(
  'SavedPageRepositoryError'
)<{ readonly message: string }> {}

export type SavedPageQuery = {
  readonly unreadOnly: boolean;
  readonly after?: SavedPageId;
  readonly limit: number;
};

export interface ISavedPageRepository {
  readonly find: (
    owner: OwnerId,
    id: SavedPageId
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  readonly findByUrl: (
    owner: OwnerId,
    url: NormalizedUrl
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  readonly list: (
    owner: OwnerId,
    query: SavedPageQuery
  ) => Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError>;
  readonly create: (
    owner: OwnerId,
    pages: ReadonlyArray<SavedPage>
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    read: boolean
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  readonly unreadCount: (
    owner: OwnerId
  ) => Effect.Effect<number, SavedPageRepositoryError>;
}

export class SavedPageRepository extends Context.Service<
  SavedPageRepository,
  ISavedPageRepository
>()('@reader/business/SavedPageRepository') {}
