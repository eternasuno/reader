import {
  type ISavedPageRepository,
  type OwnerId,
  SavedPage,
  type SavedPageQuery,
  SavedPageRepository,
  SavedPageRepositoryError,
} from '@reader/business';
import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  createEach,
  dateFromMillis,
  decodeRows,
  failWith,
  first,
  inList,
  millisOrNull,
  page,
} from './sql';

const fail = failWith(
  () =>
    new SavedPageRepositoryError({ message: 'Failed to access saved pages' })
);

const decodePages = decodeRows(SavedPage, ({ publishedAt, read, ...row }) => ({
  ...row,
  publishedAt: dateFromMillis(publishedAt),
  read: read === 1,
}));

const decodeTotal = decodeRows(Schema.Struct({ total: Schema.Int }));

const SELECT =
  'SELECT id, owner AS ownerId, url, title, description, content, published_at AS publishedAt, read FROM saved_page';

export const listSavedPagesStatement = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  query: SavedPageQuery
) => sql`${sql.literal(SELECT)} WHERE owner = ${owner}${page(sql, query)}`;

const reads = (sql: SqlClient.SqlClient) => {
  const select = sql.literal(SELECT);

  return {
    find: (owner, id) =>
      sql`${select} WHERE owner = ${owner} AND id = ${id}`.pipe(
        Effect.flatMap(decodePages),
        Effect.map(first),
        fail
      ),
    findByUrl: (owner, url) =>
      sql`${select} WHERE owner = ${owner} AND url = ${url.href}`.pipe(
        Effect.flatMap(decodePages),
        Effect.map(first),
        fail
      ),
    list: (owner, query) =>
      listSavedPagesStatement(sql, owner, query).pipe(
        Effect.flatMap(decodePages),
        fail
      ),
    unreadCount: (owner) =>
      sql`SELECT count(*) AS total FROM saved_page WHERE owner = ${owner} AND read = 0`.pipe(
        Effect.flatMap(decodeTotal),
        Effect.map(([row]) => row?.total ?? 0),
        fail
      ),
  } satisfies Partial<ISavedPageRepository>;
};

const writes = (sql: SqlClient.SqlClient) =>
  ({
    create: (owner, pages) =>
      createEach(
        sql,
        owner,
        pages,
        (row) =>
          sql`INSERT INTO saved_page (id, owner, url, title, description, content, published_at, read) VALUES (${row.id}, ${row.ownerId}, ${row.url.href}, ${row.title}, ${Option.getOrNull(row.description)}, ${row.content}, ${millisOrNull(row.publishedAt)}, ${row.read ? 1 : 0}) ON CONFLICT DO NOTHING RETURNING id`
      ).pipe(fail),
    markRead: (owner, ids, read) =>
      sql`UPDATE saved_page SET read = ${read ? 1 : 0} WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        fail
      ),
    markAllRead: (owner) =>
      sql`UPDATE saved_page SET read = 1 WHERE owner = ${owner}`.pipe(
        Effect.asVoid,
        fail
      ),
    remove: (owner, ids) =>
      sql`DELETE FROM saved_page WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        fail
      ),
  }) satisfies Partial<ISavedPageRepository>;

export const SavedPageRepositoryLive = Layer.effect(
  SavedPageRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return SavedPageRepository.of({ ...reads(sql), ...writes(sql) });
  })
);
