import {
  Feed,
  FeedId,
  type FeedPatch,
  FeedRepository,
  type FeedTitle,
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

const COLUMNS = 'id, owner AS ownerId, url, title, updatedAt';

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
LET $r${index} = IF array::len($u${index}) = 0 AND array::len($e${index}) = 0 { CREATE type::record("feed", ${row}.id) SET owner = $owner, feedId = ${row}.id, url = ${row}.url, title = ${row}.title, updatedAt = ${row}.updatedAt } ELSE { [] };
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
  updatedAt?: Date;
};

const assignments = (patch: FeedPatch): Assignments | undefined => {
  const clauses: Array<string> = [];
  const bindings: FeedBindings = {};

  if (patch.title !== undefined) {
    clauses.push('title = $title');
    bindings.title = patch.title;
  }

  if (patch.updatedAt !== undefined) {
    const { updatedAt } = patch;
    clauses.push(
      Option.isNone(updatedAt) ? 'updatedAt = NONE' : 'updatedAt = $updatedAt'
    );

    if (Option.isSome(updatedAt)) {
      bindings.updatedAt = DateTime.toDateUtc(updatedAt.value);
    }
  }

  return clauses.length === 0
    ? undefined
    : { clause: clauses.join(', '), bindings };
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
  const statements = [
    'BEGIN TRANSACTION;',
    'LET $matched = SELECT VALUE feedId FROM feed WHERE owner = $owner AND id IN $records;',
  ];

  if (set !== undefined) {
    statements.push(
      `UPDATE feed SET ${set.clause} WHERE owner = $owner AND id IN $records;`
    );
  }

  statements.push('COMMIT TRANSACTION;', 'RETURN $matched;');

  return run(
    db,
    statements.join(' '),
    { owner, records: recordsOf('feed', ids), ...set?.bindings },
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
