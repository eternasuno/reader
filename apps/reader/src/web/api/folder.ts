import { FolderApi } from '../../contract';
import {
  contractId,
  type EncodedSuccess,
  type ListPage,
  type ListQuery,
  listQuery,
  request,
  requestJson,
} from './client';
import type { FeedItem } from './feed-item';

/** Folders (`目录`): the list, create, rename, delete and the folder's items. */

const { endpoints } = FolderApi;

/** One folder in its wire (JSON) form (folders.md API). */
export type Folder = EncodedSuccess<typeof endpoints.createFolder>['item'];

/** Every folder of the owner (FD-FOLDER). */
export const listFolders = () =>
  requestJson(endpoints.listFolders, (client) => client.folder.listFolders({}));

/** Creates a folder; a duplicate name answers `FolderAlreadyExists` (FD-FOLDER-3). */
export const createFolder = (name: string) =>
  requestJson(endpoints.createFolder, (client) =>
    client.folder.createFolder({ payload: { name } })
  );

/** Renames a folder; an unknown id answers `FolderNotFound` (FD-FOLDER-5). */
export const renameFolder = (folderId: string, name: string) =>
  request((client) =>
    client.folder.renameFolder({
      params: { id: contractId(folderId) },
      payload: { name },
    })
  );

/** Deletes a folder; its feeds move to the top level (FD-FOLDER-5). */
export const removeFolder = (folderId: string) =>
  request((client) =>
    client.folder.removeFolder({ params: { id: contractId(folderId) } })
  );

/** Marks every item of a folder's feeds read (LIB-READ-5). */
export const markFolderRead = (folderId: string) =>
  request((client) =>
    client.folder.markFolderRead({ params: { id: contractId(folderId) } })
  );

/** One page of a folder's items, newest first (CM-PAGE-1). */
export const listFolderItems = (
  folderId: string,
  query: ListQuery
): Promise<ListPage<FeedItem>> =>
  requestJson(endpoints.listFolderItems, (client) =>
    client.folder.listFolderItems({
      params: { id: contractId(folderId) },
      query: listQuery(query),
    })
  );
