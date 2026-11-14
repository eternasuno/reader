import { Context, Data, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { Folder, FolderId, FolderName } from '../entity/feed/folder';

export class FolderRepositoryError extends Data.TaggedError(
  'FolderRepositoryError'
)<{ readonly message: string }> {}

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
  readonly rename: (
    owner: OwnerId,
    id: FolderId,
    name: FolderName
  ) => Effect.Effect<boolean, FolderRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FolderRepositoryError>;
}

export class FolderRepository extends Context.Service<
  FolderRepository,
  IFolderRepository
>()('@reader/business/FolderRepository') {}
