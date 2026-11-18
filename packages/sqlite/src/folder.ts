import {
  Folder,
  FolderRepository,
  FolderRepositoryError,
  type OwnerId,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  changed,
  createEach,
  decodeRows,
  failWith,
  first,
  inList,
} from './sql';

const fail = failWith(
  () => new FolderRepositoryError({ message: 'Failed to access folders' })
);

const decodeFolders = decodeRows(Folder);

const SELECT = 'SELECT id, owner AS ownerId, name FROM folder';

export const listFoldersStatement = (
  sql: SqlClient.SqlClient,
  owner: OwnerId
) => sql`${sql.literal(SELECT)} WHERE owner = ${owner} ORDER BY name, id`;

export const FolderRepositoryLive = Layer.effect(
  FolderRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const select = sql.literal(SELECT);

    return FolderRepository.of({
      find: (owner, id) =>
        sql`${select} WHERE owner = ${owner} AND id = ${id}`.pipe(
          Effect.flatMap(decodeFolders),
          Effect.map(first),
          fail
        ),
      list: (owner) =>
        listFoldersStatement(sql, owner).pipe(
          Effect.flatMap(decodeFolders),
          fail
        ),
      create: (owner, folders) =>
        createEach(
          sql,
          owner,
          folders,
          (folder) =>
            sql`INSERT INTO folder (id, owner, name) VALUES (${folder.id}, ${folder.ownerId}, ${folder.name}) ON CONFLICT DO NOTHING RETURNING id`
        ).pipe(fail),
      rename: (owner, id, name) =>
        sql`UPDATE folder SET name = ${name} WHERE owner = ${owner} AND id = ${id} AND NOT EXISTS (SELECT 1 FROM folder WHERE owner = ${owner} AND name = ${name} AND id <> ${id}) RETURNING id`.pipe(
          Effect.map(changed),
          fail
        ),
      remove: (owner, ids) =>
        sql`DELETE FROM folder WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
          Effect.asVoid,
          fail
        ),
    });
  })
);
