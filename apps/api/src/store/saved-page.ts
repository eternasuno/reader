import {
  type NormalizedUrl,
  type OwnerId,
  SavedPage,
  type SavedPageId,
  type SavedPageQuery,
  SavedPageRepository,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  afterClause,
  createRows,
  readRows,
  recordsOf,
  savedPageRepositoryError,
  write,
} from './sql';

const COLUMNS =
  'pageId AS id, owner AS ownerId, url, title, description, content, publishedAt, read';

const ORDER = 'ORDER BY pageId DESC';

const encodeSavedPage = Schema.encodeSync(SavedPage);

const findSavedPage = (db: Surreal, owner: OwnerId, id: SavedPageId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM saved_page WHERE owner = $owner AND pageId = $id LIMIT 1;`,
    { owner, id },
    SavedPage,
    savedPageRepositoryError
  ).pipe(Effect.map((pages) => Option.fromUndefinedOr(pages[0])));

const findSavedPageByUrl = (db: Surreal, owner: OwnerId, url: NormalizedUrl) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM saved_page WHERE owner = $owner AND url = $url LIMIT 1;`,
    { owner, url: url.href },
    SavedPage,
    savedPageRepositoryError
  ).pipe(Effect.map((pages) => Option.fromUndefinedOr(pages[0])));

type QueryBindings = {
  owner: OwnerId;
  limit: number;
  after?: SavedPageId;
};

const listSavedPages = (db: Surreal, owner: OwnerId, query: SavedPageQuery) => {
  const readClause = query.unreadOnly ? ' AND read = false' : '';
  const bindings: QueryBindings = { owner, limit: query.limit };

  if (query.after !== undefined) {
    bindings.after = query.after;
  }

  return readRows(
    db,
    `SELECT ${COLUMNS} FROM saved_page WHERE owner = $owner${readClause}${afterClause('pageId', query.after)} ${ORDER} LIMIT $limit;`,
    bindings,
    SavedPage,
    savedPageRepositoryError
  );
};

const insertStatement = (row: string, index: number) => `
LET $u${index} = SELECT VALUE pageId FROM saved_page WHERE owner = $owner AND url = ${row}.url;
LET $e${index} = SELECT VALUE id FROM saved_page WHERE id = type::record("saved_page", ${row}.id);
LET $r${index} = IF array::len($u${index}) = 0 AND array::len($e${index}) = 0 { CREATE type::record("saved_page", ${row}.id) SET owner = $owner, pageId = ${row}.id, url = ${row}.url, title = ${row}.title, description = ${row}.description, content = ${row}.content, publishedAt = ${row}.publishedAt, read = ${row}.read } ELSE { [] };
LET $created = array::append($created, array::len($r${index}) > 0);`;

const createSavedPages = (
  db: Surreal,
  owner: OwnerId,
  pages: ReadonlyArray<SavedPage>
) =>
  createRows(db, owner, pages, {
    prefix: 'p',
    encode: encodeSavedPage,
    statement: insertStatement,
    onError: savedPageRepositoryError,
  });

const markSavedPages = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>,
  read: boolean
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'UPDATE saved_page SET read = $read WHERE owner = $owner AND id IN $records;',
        { owner, read, records: recordsOf('saved_page', ids) },
        savedPageRepositoryError
      );

const markAllSavedPages = (db: Surreal, owner: OwnerId) =>
  write(
    db,
    'UPDATE saved_page SET read = true WHERE owner = $owner;',
    { owner },
    savedPageRepositoryError
  );

const removeSavedPages = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'DELETE saved_page WHERE owner = $owner AND id IN $records;',
        { owner, records: recordsOf('saved_page', ids) },
        savedPageRepositoryError
      );

const UnreadCountRow = Schema.Struct({
  total: Schema.Int,
});

const readUnreadCount = (db: Surreal, owner: OwnerId) =>
  readRows(
    db,
    'SELECT count() AS total FROM saved_page WHERE owner = $owner AND read = false GROUP ALL;',
    { owner },
    UnreadCountRow,
    savedPageRepositoryError
  ).pipe(Effect.map((rows) => rows[0]?.total ?? 0));

export const makeSavedPageRepository = (
  db: Surreal,
  lock: Semaphore.Semaphore
) =>
  SavedPageRepository.of({
    find: (owner, id) => findSavedPage(db, owner, id),
    findByUrl: (owner, url) => findSavedPageByUrl(db, owner, url),
    list: (owner, query) => listSavedPages(db, owner, query),
    create: (owner, pages) =>
      createSavedPages(db, owner, pages).pipe(lock.withPermit),
    markRead: (owner, ids, read) =>
      markSavedPages(db, owner, ids, read).pipe(lock.withPermit),
    markAllRead: (owner) => markAllSavedPages(db, owner).pipe(lock.withPermit),
    remove: (owner, ids) =>
      removeSavedPages(db, owner, ids).pipe(lock.withPermit),
    unreadCount: (owner) => readUnreadCount(db, owner),
  });
