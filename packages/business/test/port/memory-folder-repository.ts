import { Effect, Option, Ref } from 'effect';
import type { OwnerId } from '../../src/entity/common/owner-id';
import type {
  Folder,
  FolderId,
  FolderName,
} from '../../src/entity/feed/folder';
import type {
  FolderPatch,
  IFolderRepository,
} from '../../src/port/folder-repository';
import { byNameThenId, type Ref_ } from './memory-feed-state';

const hasFolderName = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  id: FolderId,
  name: FolderName
): boolean =>
  folders.some(
    (folder) =>
      folder.ownerId === owner && folder.id !== id && folder.name === name
  );

const isFolderTaken = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  row: Folder
): boolean =>
  row.ownerId !== owner ||
  folders.some(
    (folder) =>
      folder.id === row.id ||
      (folder.ownerId === row.ownerId && folder.name === row.name)
  );

const insertFolders = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  rows: ReadonlyArray<Folder>
) => {
  const stored: Array<Folder> = [...folders];
  const created: Array<FolderId> = [];

  for (const row of rows) {
    if (isFolderTaken(stored, owner, row)) {
      continue;
    }

    stored.push(row);
    created.push(row.id);
  }

  return { created, folders: stored };
};

const patchFolders = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  ids: ReadonlyArray<FolderId>,
  patch: FolderPatch
) => {
  const wanted = new Set<string>(ids);
  const stored: Array<Folder> = [...folders];
  const matched: Array<FolderId> = [];
  const name = patch.name;

  for (const [index, folder] of folders.entries()) {
    if (folder.ownerId !== owner || !wanted.has(folder.id)) {
      continue;
    }

    if (name !== undefined && hasFolderName(stored, owner, folder.id, name)) {
      continue;
    }

    stored[index] = { ...folder, name: name ?? folder.name };
    matched.push(folder.id);
  }

  return { folders: stored, matched };
};

const findFolder =
  (state: Ref_) =>
  (owner: OwnerId, id: FolderId): Effect.Effect<Option.Option<Folder>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.folders.find(
          (folder) => folder.ownerId === owner && folder.id === id
        )
      )
    );

const listFolders =
  (state: Ref_) =>
  (owner: OwnerId): Effect.Effect<ReadonlyArray<Folder>> =>
    Effect.map(Ref.get(state), (store) =>
      store.folders
        .filter((folder) => folder.ownerId === owner)
        .sort(byNameThenId)
    );

const createFolders =
  (state: Ref_) =>
  (
    owner: OwnerId,
    folders: ReadonlyArray<Folder>
  ): Effect.Effect<ReadonlyArray<FolderId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertFolders(store.folders, owner, folders);

      return [inserted.created, { ...store, folders: inserted.folders }];
    });

const updateFolders =
  (state: Ref_) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<FolderId>,
    patch: FolderPatch
  ): Effect.Effect<ReadonlyArray<FolderId>> =>
    Ref.modify(state, (store) => {
      const patched = patchFolders(store.folders, owner, ids, patch);

      return [patched.matched, { ...store, folders: patched.folders }];
    });

const removeFolders =
  (state: Ref_) =>
  (owner: OwnerId, ids: ReadonlyArray<FolderId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);
      const removedFolders = new Set<string>(
        store.folders
          .filter((folder) => folder.ownerId === owner && wanted.has(folder.id))
          .map((folder) => folder.id)
      );
      const removedFeeds = new Set<string>(
        store.feeds
          .filter(
            (feed) =>
              feed.ownerId === owner &&
              Option.exists(feed.folderId, (id) => removedFolders.has(id))
          )
          .map((feed) => feed.id)
      );

      return {
        ...store,
        folders: store.folders.filter(
          (folder) => !removedFolders.has(folder.id)
        ),
        feeds: store.feeds.filter((feed) => !removedFeeds.has(feed.id)),
        items: store.items.filter((item) => !removedFeeds.has(item.feedId)),
      };
    });

export const makeMemoryFolderRepository = (state: Ref_): IFolderRepository => ({
  find: findFolder(state),
  list: listFolders(state),
  create: createFolders(state),
  update: updateFolders(state),
  remove: removeFolders(state),
});
