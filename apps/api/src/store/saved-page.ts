import {
  type ISavedPageRepository,
  type NormalizedUrl,
  type OwnerId,
  SavedPage,
  type SavedPageId,
  type SavedPageQuery,
  SavedPageRepository,
  SavedPageRepositoryError,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import {
  createEach,
  cursorClause,
  dateFromMillis,
  decodeRows,
  inList,
  unreadClause,
} from './sql';

type Sql = SqlClient.SqlClient;

type Row = Readonly<Record<string, unknown>>;

const savedPageRepositoryError = () =>
  new SavedPageRepositoryError({ message: 'Failed to access saved pages' });

const fail = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
  effect.pipe(Effect.mapError(savedPageRepositoryError));

const COLUMNS =
  'id, owner AS ownerId, url, title, description, content, published_at AS publishedAt, read';

const ORDER = 'ORDER BY id DESC';

const storedRow = (row: Row): Row => ({
  ...row,
  publishedAt: dateFromMillis(row['publishedAt']),
  read: row['read'] === 1,
});

const decodePages = (rows: ReadonlyArray<Row>) =>
  decodeRows(rows.map(storedRow), SavedPage, savedPageRepositoryError);

const findSavedPage = (sql: Sql, owner: OwnerId, id: SavedPageId) =>
  sql`SELECT ${sql.literal(COLUMNS)} FROM saved_page WHERE owner = ${owner} AND id = ${id} LIMIT 1`.pipe(
    fail,
    Effect.flatMap(decodePages),
    Effect.map((pages) => Option.fromUndefinedOr(pages[0]))
  );

const findSavedPageByUrl = (sql: Sql, owner: OwnerId, url: NormalizedUrl) =>
  sql`SELECT ${sql.literal(COLUMNS)} FROM saved_page WHERE owner = ${owner} AND url = ${url.href} LIMIT 1`.pipe(
    fail,
    Effect.flatMap(decodePages),
    Effect.map((pages) => Option.fromUndefinedOr(pages[0]))
  );

const listSavedPages = (sql: Sql, owner: OwnerId, query: SavedPageQuery) =>
  sql`SELECT ${sql.literal(COLUMNS)} FROM saved_page WHERE owner = ${owner}${unreadClause(sql, query.unreadOnly)}${cursorClause(sql, query.after)} ${sql.literal(ORDER)} LIMIT ${query.limit}`.pipe(
    fail,
    Effect.flatMap(decodePages)
  );

const encodeSavedPage = Schema.encodeSync(SavedPage);

const pageValues = (row: SavedPage) => {
  const encoded = encodeSavedPage(row);

  return {
    id: encoded.id,
    owner: encoded.ownerId,
    url: encoded.url,
    title: encoded.title,
    description: encoded.description ?? null,
    content: encoded.content,
    publishedAt:
      encoded.publishedAt === undefined ? null : encoded.publishedAt.getTime(),
    read: encoded.read ? 1 : 0,
  };
};

const insertPage = (sql: Sql) => (row: SavedPage) => {
  const value = pageValues(row);

  return sql`INSERT INTO saved_page (id, owner, url, title, description, content, published_at, read) VALUES (${value.id}, ${value.owner}, ${value.url}, ${value.title}, ${value.description}, ${value.content}, ${value.publishedAt}, ${value.read}) ON CONFLICT DO NOTHING RETURNING id`;
};

const createSavedPages = (
  sql: Sql,
  owner: OwnerId,
  pages: ReadonlyArray<SavedPage>
) => createEach(sql, owner, pages, insertPage(sql)).pipe(fail);

const markSavedPages = (
  sql: Sql,
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>,
  read: boolean
) =>
  ids.length === 0
    ? Effect.void
    : sql`UPDATE saved_page SET read = ${read ? 1 : 0} WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        fail,
        Effect.asVoid
      );

const markAllSavedPages = (sql: Sql, owner: OwnerId) =>
  sql`UPDATE saved_page SET read = 1 WHERE owner = ${owner}`.pipe(
    fail,
    Effect.asVoid
  );

const removeSavedPages = (
  sql: Sql,
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>
) =>
  ids.length === 0
    ? Effect.void
    : sql`DELETE FROM saved_page WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        fail,
        Effect.asVoid
      );

const UnreadCountRow = Schema.Struct({
  total: Schema.Int,
});

const readUnreadCount = (sql: Sql, owner: OwnerId) =>
  sql`SELECT count(*) AS total FROM saved_page WHERE owner = ${owner} AND read = 0`.pipe(
    fail,
    Effect.flatMap((rows) =>
      decodeRows(rows, UnreadCountRow, savedPageRepositoryError)
    ),
    Effect.map((rows) => rows[0]?.total ?? 0)
  );

export const makeSavedPageRepository: Effect.Effect<
  ISavedPageRepository,
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return SavedPageRepository.of({
    find: (owner, id) => findSavedPage(sql, owner, id),
    findByUrl: (owner, url) => findSavedPageByUrl(sql, owner, url),
    list: (owner, query) => listSavedPages(sql, owner, query),
    create: (owner, pages) => createSavedPages(sql, owner, pages),
    markRead: (owner, ids, read) => markSavedPages(sql, owner, ids, read),
    markAllRead: (owner) => markAllSavedPages(sql, owner),
    remove: (owner, ids) => removeSavedPages(sql, owner, ids),
    unreadCount: (owner) => readUnreadCount(sql, owner),
  });
});
