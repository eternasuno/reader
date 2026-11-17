import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import { Folder, type FolderName } from '../../entity/folder/folder';
import {
  FolderAlreadyExists,
  type FolderRepositoryError,
} from '../../error/folder';
import { FolderRepository } from '../../port/folder-repository';

/**
 * Creates a folder for the owner (FD-FOLDER-4): the constructor makes its id
 * (CM-ID-3) and a create that created nothing means the name is taken
 * (CM-ID-6). A new folder is empty.
 */
export const createFolder = Effect.fn('createFolder')(function* (
  owner: OwnerId,
  name: FolderName
): Effect.fn.Return<
  Folder,
  FolderAlreadyExists | FolderRepositoryError,
  FolderRepository
> {
  const folders = yield* FolderRepository;
  const folder = yield* Folder.makeEffect({ ownerId: owner, name }).pipe(
    Effect.orDie
  );
  const created = yield* folders.create(owner, [folder]);

  if (created.length === 0) {
    return yield* new FolderAlreadyExists({ folderName: name });
  }

  return folder;
});
