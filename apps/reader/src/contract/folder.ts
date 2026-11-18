import { Folder, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { created } from './common';
import {
  FeedItemRepositoryError,
  FolderAlreadyExists,
  FolderNotFound,
  FolderRepositoryError,
  InvalidFolderName,
} from './errors';
import { feedItemListQuery, feedItemListResponse } from './feed-item';
import { OriginCheck } from './middleware';

const FolderResponse = Schema.Struct({ item: Folder });

const FolderList = Schema.Struct({ items: Schema.Array(Folder) });

const folderName = Schema.Struct({ name: Schema.String });

const folderParams = { id: FolderId };

/** Folders (`目录`): the list, create, rename, delete and mark all read. */
export const FolderApi = HttpApiGroup.make('folder').add(
  HttpApiEndpoint.get('listFolders', '/folders', {
    success: FolderList,
    error: FolderRepositoryError,
  }),
  HttpApiEndpoint.post('createFolder', '/folders', {
    payload: folderName,
    success: created(FolderResponse),
    error: [InvalidFolderName, FolderAlreadyExists, FolderRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('renameFolder', '/folders/:id', {
    params: folderParams,
    payload: folderName,
    error: [
      InvalidFolderName,
      FolderNotFound,
      FolderAlreadyExists,
      FolderRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeFolder', '/folders/:id', {
    params: folderParams,
    error: FolderRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markFolderRead', '/folders/:id/read-all', {
    params: folderParams,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.get('listFolderItems', '/folders/:id/items', {
    params: folderParams,
    query: feedItemListQuery,
    success: feedItemListResponse,
    error: FeedItemRepositoryError,
  })
);
