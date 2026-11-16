import {
  Folder,
  type FolderId,
  type FolderName,
  FolderRepository,
  FolderRepositoryError,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { createEach, decodeRows, inList } from './sql';

const encodeFolder = Schema.encodeSync(Folder);

const folderRepositoryError = () =>
  new FolderRepositoryError({ message: 'Failed to access folders' });

const decodeFolders = (
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>
) => decodeRows(rows, Folder, folderRepositoryError);

const findFolder = (sql: SqlClient.SqlClient, owner: OwnerId, id: FolderId) =>
  sql`SELECT id, owner AS ownerId, name FROM folder WHERE owner = ${owner} AND id = ${id}`.pipe(
    Effect.flatMap(decodeFolders),
    Effect.map((folders) => Option.fromUndefinedOr(folders[0])),
    Effect.mapError(folderRepositoryError)
  );

const listFolders = (sql: SqlClient.SqlClient, owner: OwnerId) =>
  sql`SELECT id, owner AS ownerId, name FROM folder WHERE owner = ${owner} ORDER BY name ASC, id ASC`.pipe(
    Effect.flatMap(decodeFolders),
    Effect.mapError(folderRepositoryError)
  );

const insertFolder = (sql: SqlClient.SqlClient) => (folder: Folder) => {
  const row = encodeFolder(folder);

  return sql`INSERT INTO folder (id, owner, name) VALUES (${row.id}, ${row.ownerId}, ${row.name}) ON CONFLICT DO NOTHING RETURNING id`;
};

const createFolders = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  folders: ReadonlyArray<Folder>
) =>
  createEach(sql, owner, folders, insertFolder(sql)).pipe(
    Effect.mapError(folderRepositoryError)
  );

const renameFolder = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  id: FolderId,
  name: FolderName
) =>
  sql`UPDATE folder SET name = ${name} WHERE owner = ${owner} AND id = ${id} AND NOT EXISTS (SELECT 1 FROM folder WHERE owner = ${owner} AND name = ${name} AND id <> ${id}) RETURNING id`.pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.mapError(folderRepositoryError)
  );

const removeFolders = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  ids: ReadonlyArray<FolderId>
) =>
  ids.length === 0
    ? Effect.void
    : sql`DELETE FROM folder WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        Effect.mapError(folderRepositoryError)
      );

export const makeFolderRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return FolderRepository.of({
    find: (owner, id) => findFolder(sql, owner, id),
    list: (owner) => listFolders(sql, owner),
    create: (owner, folders) => createFolders(sql, owner, folders),
    rename: (owner, id, name) => renameFolder(sql, owner, id, name),
    remove: (owner, ids) => removeFolders(sql, owner, ids),
  });
});
