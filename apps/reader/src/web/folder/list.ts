import { createSignal } from 'solid-js';
import { type Folder, listFolders } from '../api/folder';
import { feeds } from '../feed';

export type { Folder } from '../api/folder';

const [folderList, setFolderList] = createSignal<ReadonlyArray<Folder>>([]);

/** The owner's folders in the server's order, never re-sorted here (FD-FOLDER-8). */
export const folders = (): ReadonlyArray<Folder> => folderList();

export const folderById = (id: string): Folder | undefined =>
  folderList().find((folder) => folder.id === id);

/** The feeds that are in a folder right now (FD-LIST-6, FD-COUNT-3). */
export const feedIdsInFolder = (folderId: string): ReadonlyArray<string> =>
  feeds()
    .filter((feed) => feed.folderId === folderId)
    .map((feed) => feed.id);

/**
 * Lists the folders again. A failure rejects with `ApiFailure`; `loadSidebar`
 * reports it once (library.md API).
 */
export const loadFolders = async (): Promise<void> => {
  setFolderList((await listFolders()).items);
};
