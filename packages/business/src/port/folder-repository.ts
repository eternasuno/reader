import {
  Context,
  Data,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import { Folder, type FolderId } from '../entity/feed/folder';

export class FolderRepositoryError extends Data.TaggedError(
  'FolderRepositoryError'
)<{ readonly message: string }> {}

export const FolderPatch = Folder.mapFields((fields) =>
  Struct.map(Struct.pick(fields, ['name']), Schema.optionalKey)
);

export type FolderPatch = typeof FolderPatch.Type;

export interface IFolderRepository {
  readonly find: (
    owner: OwnerId,
    id: FolderId
  ) => Effect.Effect<Option.Option<Folder>, FolderRepositoryError>;
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Folder>, FolderRepositoryError>;
  readonly create: (
    owner: OwnerId,
    folders: ReadonlyArray<Folder>
  ) => Effect.Effect<ReadonlyArray<FolderId>, FolderRepositoryError>;
  readonly update: (
    owner: OwnerId,
    ids: ReadonlyArray<FolderId>,
    patch: FolderPatch
  ) => Effect.Effect<ReadonlyArray<FolderId>, FolderRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FolderRepositoryError>;
}

export class FolderRepository extends Context.Service<
  FolderRepository,
  IFolderRepository
>()('@reader/business/FolderRepository') {}
