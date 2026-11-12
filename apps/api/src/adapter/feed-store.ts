import {
  Feed,
  FeedId,
  type FeedPatch,
  FeedRepository,
  type FeedTitle,
  type FolderId,
  type OwnerId,
} from '@reader/business';
import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  type Bindings,
  createdIds,
  decodeReturned,
  feedRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './reader-store-sql';

const COLUMNS = 'id, owner AS ownerId, url, title, folderId, updatedAt';

const encodeFeed = Schema.encodeSync(Feed);

const toRecord = (id: FeedId) => new RecordId('feed', id);

const findFeed = (db: Surreal, owner: OwnerId, id: FeedId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM feed WHERE owner = $owner AND id = $record;`,
    { owner, record: toRecord(id) },
    Feed,
    feedRepositoryError
  ).pipe(Effect.map((feeds) => Option.fromUndefinedOr(feeds[0])));

const listFeeds = (db: Surreal, owner: OwnerId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM feed WHERE owner = $owner ORDER BY title ASC, feedId ASC;`,
    { owner },
    Feed,
    feedRepositoryError
  );

const insertStatement = (row: string, index: number) => `
LET $u${index} = SELECT VALUE feedId FROM feed WHERE owner = $owner AND url = ${row}.url;
LET $e${index} = SELECT VALUE id FROM feed WHERE id = type::record("feed", ${row}.id);
LET $g${index} = IF ${row}.folderId = NONE { [true] } ELSE { SELECT VALUE id FROM folder WHERE owner = $owner AND id = type::record("folder", ${row}.folderId) };
LET $r${index} = IF array::len($u${index}) = 0 AND array::len($e${index}) = 0 AND array::len($g${index}) > 0 { CREATE type::record("feed", ${row}.id) SET owner = $owner, feedId = ${row}.id, url = ${row}.url, title = ${row}.title, folderId = ${row}.folderId, updatedAt = ${row}.updatedAt } ELSE { [] };
LET $created = array::append($created, array::len($r${index}) > 0);`;

const createFeeds = (
  db: Surreal,
  owner: OwnerId,
  feeds: ReadonlyArray<Feed>
) => {
  const rows = feeds.filter((feed) => feed.ownerId === owner);

  if (rows.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FeedId>);
  }

  const bindings: Bindings = { owner };
  rows.forEach((feed, index) => {
    bindings[`f${index}`] = encodeFeed(feed);
  });
  const statements = rows
    .map((_, index) => insertStatement(`$f${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`,
    bindings,
    feedRepositoryError
  ).pipe(Effect.map((results) => createdIds(rows, results)));
};

type Assignments = {
  readonly clause: string;
  readonly bindings: Bindings;
};

type FeedBindings = {
  title?: FeedTitle;
  folderId?: FolderId;
  updatedAt?: Date;
};

const optionClause = (column: string, value: Option.Option<unknown>) =>
  Option.isNone(value) ? `${column} = NONE` : `${column} = $${column}`;

const titleBinding = (title: FeedTitle | undefined): FeedBindings =>
  title === undefined ? {} : { title };

const folderBinding = (
  folderId: Option.Option<FolderId> | undefined
): FeedBindings =>
  folderId === undefined || Option.isNone(folderId)
    ? {}
    : { folderId: folderId.value };

const updatedAtBinding = (
  updatedAt: Option.Option<DateTime.Utc> | undefined
): FeedBindings =>
  updatedAt === undefined || Option.isNone(updatedAt)
    ? {}
    : { updatedAt: DateTime.toDateUtc(updatedAt.value) };

const assignments = (patch: FeedPatch): Assignments | undefined => {
  const clauses: Array<string> = [];

  if (patch.title !== undefined) {
    clauses.push('title = $title');
  }

  if (patch.folderId !== undefined) {
    clauses.push(optionClause('folderId', patch.folderId));
  }

  if (patch.updatedAt !== undefined) {
    clauses.push(optionClause('updatedAt', patch.updatedAt));
  }

  if (clauses.length === 0) {
    return undefined;
  }

  return {
    clause: clauses.join(', '),
    bindings: {
      ...titleBinding(patch.title),
      ...folderBinding(patch.folderId),
      ...updatedAtBinding(patch.updatedAt),
    },
  };
};

const MATCH =
  'SELECT VALUE feedId FROM feed WHERE owner = $owner AND id IN $records';

const guarded = (guard: boolean, statement: string) =>
  guard ? `IF array::len($folder) = 0 { [] } ELSE { ${statement} }` : statement;

const updateStatements = (
  set: Assignments | undefined,
  checksFolder: boolean
) => {
  const statements = ['BEGIN TRANSACTION;'];

  if (checksFolder) {
    statements.push(
      'LET $folder = SELECT VALUE folderId FROM folder WHERE owner = $owner AND id = $folderRecord;'
    );
  }

  statements.push(`LET $matched = ${guarded(checksFolder, MATCH)};`);

  if (set !== undefined) {
    const update = `UPDATE feed SET ${set.clause} WHERE owner = $owner AND id IN $records`;

    statements.push(
      checksFolder ? `LET $updated = ${guarded(true, update)};` : `${update};`
    );
  }

  statements.push('COMMIT TRANSACTION;', 'RETURN $matched;');

  return statements;
};

const updateFeeds = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FeedId>,
  patch: FeedPatch
) => {
  if (ids.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FeedId>);
  }

  const set = assignments(patch);
  const folder = patch.folderId ?? Option.none<FolderId>();
  const checksFolder = Option.isSome(folder);
  const bindings: Bindings = {
    owner,
    records: recordsOf('feed', ids),
    ...set?.bindings,
    ...(Option.isSome(folder)
      ? { folderRecord: new RecordId('folder', folder.value) }
      : {}),
  };

  return run(
    db,
    updateStatements(set, checksFolder).join(' '),
    bindings,
    feedRepositoryError
  ).pipe(
    Effect.flatMap((results) =>
      decodeReturned(results, Schema.Array(FeedId), feedRepositoryError)
    )
  );
};

const removeFeeds = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FeedId>
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'BEGIN TRANSACTION; LET $owned = SELECT VALUE feedId FROM feed WHERE owner = $owner AND id IN $records; DELETE feed_item WHERE owner = $owner AND feedId IN $owned; DELETE feed WHERE owner = $owner AND id IN $records; COMMIT TRANSACTION;',
        { owner, records: recordsOf('feed', ids) },
        feedRepositoryError
      );

export const makeFeedRepository = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedRepository.of({
    find: (owner, id) => findFeed(db, owner, id),
    list: (owner) => listFeeds(db, owner),
    create: (owner, feeds) =>
      createFeeds(db, owner, feeds).pipe(lock.withPermit),
    update: (owner, ids, patch) =>
      updateFeeds(db, owner, ids, patch).pipe(lock.withPermit),
    remove: (owner, ids) => removeFeeds(db, owner, ids).pipe(lock.withPermit),
  });
