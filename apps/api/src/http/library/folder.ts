import {
  createFolder as createFolderUseCase,
  FeedItemRepository,
  FolderRepository,
  renameFolder as renameFolderUseCase,
} from '@reader/business';
import { Effect } from 'effect';
import {
  createFolderFailure,
  feedItemRepositoryFailure,
  folderRepositoryFailure,
  renameFolderFailure,
} from './failures';
import { decodeFolderName } from './input';
import { type HandlerRequest, handle, handleOk } from './session';

const folders = () =>
  handle(folderRepositoryFailure, (owner) =>
    Effect.flatMap(FolderRepository, (repository) =>
      Effect.map(repository.list(owner), (items) => ({ items }))
    )
  );

const create = ({ payload }: HandlerRequest<'createFolder'>) =>
  handle(createFolderFailure, (owner) =>
    Effect.flatMap(decodeFolderName(payload.name), (name) =>
      Effect.map(createFolderUseCase(owner, name), (item) => ({ item }))
    )
  );

const rename = ({ payload }: HandlerRequest<'renameFolder'>) =>
  handleOk(renameFolderFailure, (owner) =>
    Effect.flatMap(decodeFolderName(payload.name), (name) =>
      renameFolderUseCase(owner, payload.id, name)
    )
  );

const remove = ({ payload }: HandlerRequest<'removeFolder'>) =>
  handleOk(folderRepositoryFailure, (owner) =>
    Effect.flatMap(FolderRepository, (repository) =>
      repository.remove(owner, [payload.id])
    )
  );

const markFolders = ({ payload }: HandlerRequest<'markFoldersRead'>) =>
  handleOk(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      repository.markReadByFolders(owner, payload.folderIds)
    )
  );

export const folderHandlers = {
  folders,
  createFolder: create,
  renameFolder: rename,
  removeFolder: remove,
  markFoldersRead: markFolders,
};
