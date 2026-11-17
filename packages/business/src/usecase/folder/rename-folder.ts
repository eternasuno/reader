import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FolderId, FolderName } from '../../entity/folder/folder';
import {
  FolderAlreadyExists,
  FolderNotFound,
  type FolderRepositoryError,
} from '../../error/folder';
import { FolderRepository } from '../../port/folder-repository';

/**
 * Renames a folder (FD-FOLDER-5). A rename that wrote nothing is either an
 * unknown folder or a taken name, told apart by looking the folder up only
 * then (FD-OWN-2). Renaming to the current name changes nothing and succeeds;
 * no feed and no item changes.
 */
export const renameFolder = Effect.fn('renameFolder')(function* (
  owner: OwnerId,
  folderId: FolderId,
  name: FolderName
): Effect.fn.Return<
  void,
  FolderNotFound | FolderAlreadyExists | FolderRepositoryError,
  FolderRepository
> {
  const folders = yield* FolderRepository;
  const written = yield* folders.rename(owner, folderId, name);

  if (written) {
    return;
  }

  const folder = yield* folders.find(owner, folderId);

  if (Option.isNone(folder)) {
    return yield* new FolderNotFound({ id: folderId });
  }

  return yield* new FolderAlreadyExists({ folderName: name });
});
