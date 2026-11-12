import { Folder, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  created,
  FolderAlreadyExistsSchema,
  FolderNotFoundSchema,
  feedItemErrors,
  folderErrors,
  InvalidFolderNameSchema,
  ok,
} from './common';

export const folderEndpoints = [
  HttpApiEndpoint.get('folders', '/api/library/folders', {
    success: Schema.Struct({ items: Schema.Array(Folder) }),
    error: folderErrors,
  }),
  HttpApiEndpoint.post('createFolder', '/api/library/folders', {
    payload: Schema.Struct({ name: Schema.String }),
    success: created(Schema.Struct({ item: Folder })),
    error: [
      InvalidFolderNameSchema,
      FolderAlreadyExistsSchema,
      ...folderErrors,
    ],
  }),
  HttpApiEndpoint.patch('renameFolder', '/api/library/folders', {
    payload: Schema.Struct({ id: FolderId, name: Schema.String }),
    success: ok,
    error: [
      InvalidFolderNameSchema,
      FolderNotFoundSchema,
      FolderAlreadyExistsSchema,
      ...folderErrors,
    ],
  }),
  HttpApiEndpoint.delete('removeFolder', '/api/library/folders', {
    payload: Schema.Struct({ id: FolderId }),
    success: ok,
    error: folderErrors,
  }),
  HttpApiEndpoint.post('markFoldersRead', '/api/library/folders/mark-read', {
    payload: Schema.Struct({ folderIds: Schema.Array(FolderId) }),
    success: ok,
    error: feedItemErrors,
  }),
] as const;
