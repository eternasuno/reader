import {
  createFolder,
  FeedItemRepository,
  FolderRepository,
  listFolderItems,
  renameFolder,
} from '@reader/business';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { decodeFolderName, pageInput } from './decode';
import { handle } from './errors';

/** The owner's folders by name, then id; not paged (FD-FOLDER-8). */
const list = HttpApiBuilder.handler(ReaderApi, 'folder', 'listFolders', () =>
  handle((owner) =>
    Effect.map(
      Effect.flatMap(FolderRepository, (folders) => folders.list(owner)),
      (items) => ({ items: [...items] })
    )
  )
);

/** Creates one folder from a trimmed, non-blank name (FD-FOLDER-4). */
const create = HttpApiBuilder.handler(
  ReaderApi,
  'folder',
  'createFolder',
  ({ payload }) =>
    Effect.gen(function* () {
      const name = yield* decodeFolderName(payload.name);
      const item = yield* handle((owner) => createFolder(owner, name));

      return { item };
    })
);

/** Renames a folder; the current name is not a conflict (FD-FOLDER-5). */
const rename = HttpApiBuilder.handler(
  ReaderApi,
  'folder',
  'renameFolder',
  ({ params, payload }) =>
    Effect.gen(function* () {
      const name = yield* decodeFolderName(payload.name);

      yield* handle((owner) => renameFolder(owner, params.id, name));
    })
);

/** Removes the folder with its feeds and their items (FD-FOLDER-7). */
const remove = HttpApiBuilder.handler(
  ReaderApi,
  'folder',
  'removeFolder',
  ({ params }) =>
    handle((owner) =>
      Effect.flatMap(FolderRepository, (folders) =>
        folders.remove(owner, [params.id])
      )
    )
);

/** Items of the feeds in the folder now (FD-READ-5). */
const markRead = HttpApiBuilder.handler(
  ReaderApi,
  'folder',
  'markFolderRead',
  ({ params }) =>
    handle((owner) =>
      Effect.flatMap(FeedItemRepository, (items) =>
        items.markReadByFolders(owner, [params.id])
      )
    )
);

/** One page of a folder; unknown, foreign or empty is an empty page (FD-LIST-7). */
const items = HttpApiBuilder.handler(
  ReaderApi,
  'folder',
  'listFolderItems',
  ({ params, query }) =>
    handle((owner) =>
      Effect.map(
        listFolderItems(owner, params.id, pageInput(query)),
        (page) => ({
          items: [...page.items],
          cursor: page.cursor,
        })
      )
    )
);

export const FolderHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'folder',
  (handlers) =>
    handlers.handleAll({
      listFolders: list,
      createFolder: create,
      renameFolder: rename,
      removeFolder: remove,
      markFolderRead: markRead,
      listFolderItems: items,
    })
);
