import { Effect, Option, Ref } from 'effect';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type {
  Folder,
  FolderId,
  FolderName,
} from '../../../../src/entity/folder/folder';
import type { IFolderRepository } from '../../../../src/port/folder-repository';
import { byNameThenId, type FeedStateRef } from './state';

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
): {
  readonly folders: ReadonlyArray<Folder>;
  readonly created: ReadonlyArray<FolderId>;
} => {
  const stored: Array<Folder> = [...folders];
  const created: Array<FolderId> = [];

  for (const row of rows) {
    if (!isFolderTaken(stored, owner, row)) {
      stored.push(row);
      created.push(row.id);
    }
  }

  return { folders: stored, created };
};

const findFolder =
  (state: FeedStateRef) =>
  (owner: OwnerId, id: FolderId): Effect.Effect<Option.Option<Folder>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.folders.find(
          (folder) => folder.ownerId === owner && folder.id === id
        )
      )
    );

const listFolders =
  (state: FeedStateRef) =>
  (owner: OwnerId): Effect.Effect<ReadonlyArray<Folder>> =>
    Effect.map(Ref.get(state), (store) =>
      store.folders
        .filter((folder) => folder.ownerId === owner)
        .sort(byNameThenId)
    );

const createFolders =
  (state: FeedStateRef) =>
  (
    owner: OwnerId,
    folders: ReadonlyArray<Folder>
  ): Effect.Effect<ReadonlyArray<FolderId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertFolders(store.folders, owner, folders);

      return [inserted.created, { ...store, folders: inserted.folders }];
    });

const renameFolder =
  (state: FeedStateRef) =>
  (owner: OwnerId, id: FolderId, name: FolderName): Effect.Effect<boolean> =>
    Ref.modify(state, (store) => {
      const folder = store.folders.find(
        (row) => row.ownerId === owner && row.id === id
      );

      if (
        folder === undefined ||
        hasFolderName(store.folders, owner, id, name)
      ) {
        return [false, store];
      }

      return [
        true,
        {
          ...store,
          folders: store.folders.map((row) =>
            row.id === id ? { ...row, name } : row
          ),
        },
      ];
    });

const removeFolders =
  (state: FeedStateRef) =>
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

export const makeMemoryFolderRepository = (
  state: FeedStateRef
): IFolderRepository => ({
  find: findFolder(state),
  list: listFolders(state),
  create: createFolders(state),
  rename: renameFolder(state),
  remove: removeFolders(state),
});
