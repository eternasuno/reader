import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import { Folder, type FolderName } from '../../entity/feed/folder';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../port/folder-repository';
import { FolderAlreadyExists } from './errors';

export const createFolder = (
  owner: OwnerId,
  name: FolderName
): Effect.Effect<
  Folder,
  FolderAlreadyExists | FolderRepositoryError,
  FolderRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FolderRepository;
    const folder = yield* Folder.makeEffect({ ownerId: owner, name }).pipe(
      Effect.orDie
    );
    const created = yield* repository.create(owner, [folder]);

    if (created.length === 0) {
      return yield* new FolderAlreadyExists({ folderName: name });
    }

    return folder;
  });
