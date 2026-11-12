import {
  type NormalizedUrl,
  type OwnerId,
  SavedPage,
  SavedPageId,
  type SavedPagePatch,
  type SavedPageQuery,
  SavedPageRepository,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import type { RecordId, Surreal } from 'surrealdb';
import {
  afterClause,
  type Bindings,
  createdIds,
  decodeReturned,
  readRows,
  recordsOf,
  run,
  savedPageRepositoryError,
  write,
} from './reader-store-sql';

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
) => {
  const rows = pages.filter((page) => page.ownerId === owner);

  if (rows.length === 0) {
    return Effect.succeed([] as ReadonlyArray<SavedPageId>);
  }

  const bindings: Bindings = { owner };
  rows.forEach((page, index) => {
    bindings[`p${index}`] = encodeSavedPage(page);
  });
  const statements = rows
    .map((_, index) => insertStatement(`$p${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`,
    bindings,
    savedPageRepositoryError
  ).pipe(Effect.map((results) => createdIds(rows, results)));
};

type Assignments = {
  readonly clause: string;
  readonly bindings: Bindings;
};

const assignments = (patch: SavedPagePatch): Assignments | undefined =>
  patch.read === undefined
    ? undefined
    : { clause: 'read = $read', bindings: { read: patch.read } };

const updateWhere = (
  db: Surreal,
  owner: OwnerId,
  records: ReadonlyArray<RecordId>,
  set: Assignments | undefined
) => {
  const statements = [
    'BEGIN TRANSACTION;',
    'LET $matched = SELECT VALUE pageId FROM saved_page WHERE owner = $owner AND id IN $records;',
  ];

  if (set !== undefined) {
    statements.push(
      `UPDATE saved_page SET ${set.clause} WHERE owner = $owner AND id IN $records;`
    );
  }

  statements.push('COMMIT TRANSACTION;', 'RETURN $matched;');

  return run(
    db,
    statements.join(' '),
    { owner, records, ...set?.bindings },
    savedPageRepositoryError
  ).pipe(
    Effect.flatMap((results) =>
      decodeReturned(
        results,
        Schema.Array(SavedPageId),
        savedPageRepositoryError
      )
    )
  );
};

const updateSavedPages = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>,
  patch: SavedPagePatch
) =>
  ids.length === 0
    ? Effect.succeed([] as ReadonlyArray<SavedPageId>)
    : updateWhere(db, owner, recordsOf('saved_page', ids), assignments(patch));

const updateAllSavedPages = (
  db: Surreal,
  owner: OwnerId,
  patch: SavedPagePatch
) => {
  const set = assignments(patch);

  return set === undefined
    ? Effect.void
    : write(
        db,
        `UPDATE saved_page SET ${set.clause} WHERE owner = $owner;`,
        { owner, ...set.bindings },
        savedPageRepositoryError
      );
};

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

export const makeSavedPages = (db: Surreal, lock: Semaphore.Semaphore) =>
  SavedPageRepository.of({
    find: (owner, id) => findSavedPage(db, owner, id),
    findByUrl: (owner, url) => findSavedPageByUrl(db, owner, url),
    list: (owner, query) => listSavedPages(db, owner, query),
    create: (owner, pages) =>
      createSavedPages(db, owner, pages).pipe(lock.withPermit),
    update: (owner, ids, patch) =>
      updateSavedPages(db, owner, ids, patch).pipe(lock.withPermit),
    updateAll: (owner, patch) =>
      updateAllSavedPages(db, owner, patch).pipe(lock.withPermit),
    remove: (owner, ids) =>
      removeSavedPages(db, owner, ids).pipe(lock.withPermit),
    unreadCount: (owner) => readUnreadCount(db, owner),
  });
