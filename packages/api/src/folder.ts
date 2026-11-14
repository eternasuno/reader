import { Folder, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import { created, ok } from './common';
import {
  FeedItemRepositoryError,
  FolderAlreadyExists,
  FolderNotFound,
  FolderRepositoryError,
  InvalidFolderName,
} from './errors';
import { OriginCheck } from './middleware';

export const folderEndpoints = [
  HttpApiEndpoint.get('folders', '/api/library/folders', {
    success: Schema.Struct({ items: Schema.Array(Folder) }),
    error: FolderRepositoryError,
  }),
  HttpApiEndpoint.post('createFolder', '/api/library/folders', {
    payload: Schema.Struct({ name: Schema.String }),
    success: created(Schema.Struct({ item: Folder })),
    error: [InvalidFolderName, FolderAlreadyExists, FolderRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('renameFolder', '/api/library/folders', {
    payload: Schema.Struct({ id: FolderId, name: Schema.String }),
    success: ok,
    error: [
      InvalidFolderName,
      FolderNotFound,
      FolderAlreadyExists,
      FolderRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeFolder', '/api/library/folders', {
    payload: Schema.Struct({ id: FolderId }),
    success: ok,
    error: FolderRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markFoldersRead', '/api/library/folders/mark-read', {
    payload: Schema.Struct({ folderIds: Schema.Array(FolderId) }),
    success: ok,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
] as const;
