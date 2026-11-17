import { Context, Data, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { Folder, FolderId, FolderName } from '../entity/feed/folder';

export class FolderRepositoryError extends Data.TaggedError(
  'FolderRepositoryError'
)<{ readonly message: string }> {}

/**
 * All methods are scoped by `ownerId`. Write semantics are those of CM-PORT.
 */
export interface IFolderRepository {
  /** `Option` of the folder. */
  readonly find: (
    owner: OwnerId,
    id: FolderId
  ) => Effect.Effect<Option.Option<Folder>, FolderRepositoryError>;
  /** The owner's folders ordered by name, then id (FD-FOLDER-8). */
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Folder>, FolderRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT-6). A row is skipped when its id
   * exists, when the owner already has a folder of that name (CM-ID-6), or
   * when its `ownerId` differs from `owner`; two creates of one name at once:
   * exactly one succeeds.
   */
  readonly create: (
    owner: OwnerId,
    folders: ReadonlyArray<Folder>
  ) => Effect.Effect<ReadonlyArray<FolderId>, FolderRepositoryError>;
  /**
   * Sets the folder's `name` and returns `true`; renaming to the current name
   * is `true` and changes nothing. Returns `false` and writes nothing when the
   * folder is not the owner's or when another folder of the owner has the
   * name; the name check and the write are one atomic write, so two renames to
   * one name at once: exactly one succeeds.
   */
  readonly rename: (
    owner: OwnerId,
    id: FolderId,
    name: FolderName
  ) => Effect.Effect<boolean, FolderRepositoryError>;
  /**
   * Removes the owner's folders among `ids`, **their feeds and those feeds'
   * items**, in one atomic write (FD-FOLDER-7); unknown ids ignored.
   */
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FolderRepositoryError>;
}

export class FolderRepository extends Context.Service<
  FolderRepository,
  IFolderRepository
>()('@reader/business/FolderRepository') {}
