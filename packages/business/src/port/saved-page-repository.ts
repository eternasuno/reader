import {
  Context,
  Data,
  type DateTime,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import type { OwnerId } from '../entity/object-value/owner-id';
import { SavedPage, type SavedPageId } from '../entity/saved-page/saved-page';

export class SavedPageRepositoryError extends Data.TaggedError(
  'SavedPageRepositoryError'
)<{ readonly message: string }> {}

export type SavedPageBoundary = {
  readonly publishedAt: DateTime.Utc;
  readonly id: SavedPageId;
};

export type SavedPageQuery = {
  readonly read?: boolean;
  readonly after?: SavedPageBoundary;
  readonly limit: number;
};

export type SavedPageThroughQuery = {
  readonly read?: boolean;
  readonly through: SavedPageBoundary;
};

export const SavedPagePatch = SavedPage.mapFields((fields) =>
  Struct.map(Struct.pick(fields, ['read']), Schema.optionalKey)
);

export type SavedPagePatch = typeof SavedPagePatch.Type;

export interface ISavedPageRepository {
  readonly find: (
    ownerId: OwnerId,
    id: SavedPageId
  ) => Effect.Effect<Option.Option<SavedPage>, SavedPageRepositoryError>;
  readonly list: (
    ownerId: OwnerId,
    query: SavedPageQuery
  ) => Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError>;
  readonly listThrough: (
    ownerId: OwnerId,
    query: SavedPageThroughQuery
  ) => Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError>;
  readonly create: (
    pages: ReadonlyArray<SavedPage>
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  readonly update: (
    ownerId: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    patch: SavedPagePatch
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  readonly updateAll: (
    ownerId: OwnerId,
    patch: SavedPagePatch
  ) => Effect.Effect<ReadonlyArray<SavedPageId>, SavedPageRepositoryError>;
  readonly remove: (
    ownerId: OwnerId,
    ids: ReadonlyArray<SavedPageId>
  ) => Effect.Effect<void, SavedPageRepositoryError>;
  readonly unreadCount: (
    ownerId: OwnerId
  ) => Effect.Effect<number, SavedPageRepositoryError>;
}

export class SavedPageRepository extends Context.Service<
  SavedPageRepository,
  ISavedPageRepository
>()('@reader/business/SavedPageRepository') {}
