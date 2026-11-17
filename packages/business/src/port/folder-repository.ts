import { Context, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { Folder, FolderId, FolderName } from '../entity/folder/folder';
import type { FolderRepositoryError } from '../error/folder';

/**
 * Every method is scoped to the owner passed in (CM-OWN-2); a row of another
 * owner is absent, not an error (CM-OWN-3). Write semantics are those of
 * CM-PORT-3, CM-PORT-5 and CM-PORT-6; every implementation satisfies them
 * (CM-PORT-1).
 */
export interface IFolderRepository {
  /** None for a folder that does not exist for the owner (FD-FOLDER-5, FD-SUB step 2). */
  readonly find: (
    owner: OwnerId,
    id: FolderId
  ) => Effect.Effect<Option.Option<Folder>, FolderRepositoryError>;
  /**
   * The owner's folders ordered by name, then id, compared in UTF-8 byte order
   * (FD-FOLDER-8). Folders are not paged (CM-PAGE) and an empty folder is kept
   * and listed.
   */
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Folder>, FolderRepositoryError>;
  /**
   * Returns the ids actually created (CM-PORT-6). A row is skipped, never
   * overwritten, when its id exists, when its `ownerId` differs from `owner`,
   * or when the owner already has a folder of that name compared exactly as
   * stored (CM-ID-6, FD-FOLDER-2); two creates of one name at once create one
   * folder (FD-FOLDER-4).
   */
  readonly create: (
    owner: OwnerId,
    folders: ReadonlyArray<Folder>
  ) => Effect.Effect<ReadonlyArray<FolderId>, FolderRepositoryError>;
  /**
   * Sets the folder's `name` and returns `true`; renaming to the current name
   * succeeds and changes nothing (FD-FOLDER-5). Returns `false` and writes
   * nothing when the folder is not the owner's or when another folder of the
   * owner has that name; the name check and the write are one atomic statement
   * (CM-PORT-5).
   */
  readonly rename: (
    owner: OwnerId,
    id: FolderId,
    name: FolderName
  ) => Effect.Effect<boolean, FolderRepositoryError>;
  /**
   * Removes the owner's folders among `ids` with every feed in them and those
   * feeds' items, in one atomic write; saved pages stay (FD-FOLDER-7,
   * FD-UNSUB-3). Unknown and foreign ids are ignored and an empty list changes
   * nothing.
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
