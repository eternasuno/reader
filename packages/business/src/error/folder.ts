import { Data } from 'effect';
import type { FolderId, FolderName } from '../entity/folder/folder';

/**
 * The owner already has a folder of this name, compared case-sensitively. It
 * carries the key, so nothing is looked up when the unique name lost the race
 * (CM-ID-6, FD-FOLDER-4, FD-FOLDER-5).
 */
export class FolderAlreadyExists extends Data.TaggedError(
  'FolderAlreadyExists'
)<{
  readonly folderName: FolderName;
}> {}

/**
 * The folder does not exist for this owner. Only the operations that cannot go
 * on without it raise it (FD-FOLDER-5, FD-MOVE-3, FD-SUB-6); renaming, moving
 * and subscribing look the folder up only after the write created or changed
 * nothing (FD-OWN-2).
 */
export class FolderNotFound extends Data.TaggedError('FolderNotFound')<{
  readonly id: FolderId;
}> {}

/** A storage failure raised by the `FolderRepository` port. */
export class FolderRepositoryError extends Data.TaggedError(
  'FolderRepositoryError'
)<{ readonly message: string }> {}
