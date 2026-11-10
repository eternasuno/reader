import {
  type OwnerId,
  SavedPage,
  type SavedPageId,
  type SavedPagePatch,
  type SavedPageQuery,
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '@reader/business';
import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  afterBoundary,
  type Bindings,
  one,
  readBindings,
  readClause,
  run,
  savedPageRepositoryError,
  savedPages,
  write,
} from './reader-store-sql';

const COLUMNS =
  'pageId AS id, owner AS ownerId, url, title, description, content, publishedAt, read';

const ORDER = 'ORDER BY publishedAt DESC, pageId DESC';

const encodeSavedPage = Schema.encodeSync(SavedPage);

const createSavedPages = (db: Surreal, pages: ReadonlyArray<SavedPage>) => {
  if (pages.length === 0) {
    return Effect.succeed([] as ReadonlyArray<SavedPageId>);
  }

  const bindings: Bindings = {};
  pages.forEach((page, index) => {
    bindings[`p${index}`] = { ...encodeSavedPage(page), owner: page.ownerId };
  });
  const inserts = pages
    .map(
      (_, index) =>
        `UPSERT type::record("saved_page", $p${index}.id) SET owner = $p${index}.owner, pageId = $p${index}.id, url = $p${index}.url, title = $p${index}.title, description = $p${index}.description, content = $p${index}.content, publishedAt = $p${index}.publishedAt, read = $p${index}.read WHERE owner = NONE RETURN AFTER;`
    )
    .join(' ');

  return run<unknown, SavedPageRepositoryError>(
    db,
    `BEGIN TRANSACTION; ${inserts} COMMIT TRANSACTION;`,
    bindings,
    savedPageRepositoryError
  ).pipe(
    Effect.map((results) =>
      pages.flatMap((page, index) => {
        const created = results[index + 1];

        return Array.isArray(created) && created.length > 0 ? [page.id] : [];
      })
    )
  );
};

const updateWhere = (
  db: Surreal,
  owner: OwnerId,
  clause: string,
  scopeBindings: Bindings,
  patch: SavedPagePatch
) =>
  patch.read === undefined
    ? Effect.succeed([] as ReadonlyArray<SavedPageId>)
    : one<Array<{ pageId: SavedPageId }>, SavedPageRepositoryError>(
        db,
        `UPDATE saved_page SET read = $read WHERE owner = $owner${clause} RETURN AFTER;`,
        { owner, read: patch.read, ...scopeBindings },
        savedPageRepositoryError
      ).pipe(Effect.map((rows) => rows.map((row) => row.pageId)));

const afterClause = (after: SavedPageQuery['after']) =>
  after === undefined ? '' : afterBoundary('pageId');

const pageBindings = (owner: OwnerId, query: SavedPageQuery): Bindings => ({
  owner,
  limit: query.limit,
  ...readBindings(query.read),
  ...(query.after === undefined
    ? {}
    : {
        afterAt: DateTime.toDate(query.after.publishedAt),
        afterId: query.after.id,
      }),
});

const UnreadRow = Schema.Struct({
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const unreadCount = (db: Surreal, owner: OwnerId) =>
  one<unknown, SavedPageRepositoryError>(
    db,
    'SELECT count() AS total FROM saved_page WHERE owner = $owner AND read = false GROUP ALL;',
    { owner },
    savedPageRepositoryError
  ).pipe(
    Effect.flatMap((rows) =>
      Schema.decodeUnknownEffect(Schema.Array(UnreadRow))(rows).pipe(
        Effect.map((decoded) => decoded[0]?.total ?? 0),
        Effect.mapError(savedPageRepositoryError)
      )
    )
  );

const readQueries = (db: Surreal) => ({
  find: (owner: OwnerId, id: SavedPageId) =>
    savedPages(
      db,
      `SELECT ${COLUMNS} FROM saved_page WHERE owner = $owner AND id = type::record("saved_page", $id);`,
      { owner, id }
    ).pipe(Effect.map((pages) => Option.fromNullishOr(pages[0]))),
  list: (owner: OwnerId, query: SavedPageQuery) =>
    savedPages(
      db,
      `SELECT ${COLUMNS} FROM saved_page WHERE owner = $owner${readClause(query.read)}${afterClause(query.after)} ${ORDER} LIMIT $limit;`,
      pageBindings(owner, query)
    ),
  unreadCount: (owner: OwnerId) => unreadCount(db, owner),
});

const writeCommands = (db: Surreal, lock: Semaphore.Semaphore) => ({
  create: (pages: ReadonlyArray<SavedPage>) =>
    createSavedPages(db, pages).pipe(lock.withPermit),
  update: (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    patch: SavedPagePatch
  ) =>
    (ids.length === 0
      ? Effect.succeed([] as ReadonlyArray<SavedPageId>)
      : updateWhere(db, owner, ' AND pageId IN $ids', { ids }, patch)
    ).pipe(lock.withPermit),
  updateAll: (owner: OwnerId, patch: SavedPagePatch) =>
    updateWhere(db, owner, '', {}, patch).pipe(lock.withPermit),
  remove: (owner: OwnerId, ids: ReadonlyArray<SavedPageId>) =>
    (ids.length === 0
      ? Effect.void
      : write(
          db,
          'DELETE saved_page WHERE owner = $owner AND pageId IN $ids;',
          { owner, ids },
          savedPageRepositoryError
        )
    ).pipe(lock.withPermit),
});

export const makeSavedPages = (db: Surreal, lock: Semaphore.Semaphore) =>
  SavedPageRepository.of({
    ...readQueries(db),
    ...writeCommands(db, lock),
  });
