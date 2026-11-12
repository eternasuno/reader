import {
  createFolder as createFolderUseCase,
  FeedItemRepository,
  FolderRepository,
  renameFolder as renameFolderUseCase,
} from '@reader/business';
import { Effect } from 'effect';
import { type HandlerRequest, withSession } from './library-contract';
import {
  createFolderFailure,
  feedItemRepositoryFailure,
  folderRepositoryFailure,
  renameFolderFailure,
} from './library-failures';
import { decodeFolderName } from './library-input';

const folders = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FolderRepository;

      return { items: yield* repository.list(owner) };
    })
  ).pipe(Effect.catchTags(folderRepositoryFailure));

const create = ({ payload }: HandlerRequest<'createFolder'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const name = yield* decodeFolderName(payload.name);

      return { item: yield* createFolderUseCase(owner, name) };
    })
  ).pipe(Effect.catchTags(createFolderFailure));

const rename = ({ payload }: HandlerRequest<'renameFolder'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const name = yield* decodeFolderName(payload.name);
      yield* renameFolderUseCase(owner, payload.id, name);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(renameFolderFailure));

const remove = ({ payload }: HandlerRequest<'removeFolder'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FolderRepository;
      yield* repository.remove(owner, [payload.id]);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(folderRepositoryFailure));

const markFolders = ({ payload }: HandlerRequest<'markFoldersRead'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      yield* repository.updateByFolders(owner, payload.folderIds, {
        read: true,
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

export const folderHandlers = {
  folders,
  createFolder: create,
  renameFolder: rename,
  removeFolder: remove,
  markFoldersRead: markFolders,
};
