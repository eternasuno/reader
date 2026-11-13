import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FolderId, FolderName } from '../../entity/feed/folder';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../port/folder-repository';
import { FolderAlreadyExists, FolderNotFound } from './errors';

export const renameFolder = (
  owner: OwnerId,
  folderId: FolderId,
  name: FolderName
): Effect.Effect<
  void,
  FolderNotFound | FolderAlreadyExists | FolderRepositoryError,
  FolderRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FolderRepository;
    const written = yield* repository.rename(owner, folderId, name);

    if (written) {
      return;
    }

    const folder = yield* repository.find(owner, folderId);

    if (Option.isNone(folder)) {
      return yield* new FolderNotFound({ id: folderId });
    }

    return yield* new FolderAlreadyExists({ folderName: name });
  });
