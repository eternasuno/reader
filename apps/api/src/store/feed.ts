import {
  Feed,
  type FeedId,
  FeedRepository,
  type FeedTitle,
  type FolderId,
  type OwnerId,
} from '@reader/business';
import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  createRows,
  feedRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './sql';

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

const createFeeds = (db: Surreal, owner: OwnerId, feeds: ReadonlyArray<Feed>) =>
  createRows(db, owner, feeds, {
    prefix: 'f',
    encode: encodeFeed,
    statement: insertStatement,
    onError: feedRepositoryError,
  });

const MOVE = `BEGIN TRANSACTION;
LET $folder = IF $folderId = NONE { [true] } ELSE { SELECT VALUE id FROM folder WHERE owner = $owner AND id = type::record("folder", $folderId) };
LET $moved = IF array::len($folder) = 0 { [] } ELSE { UPDATE feed SET folderId = $folderId WHERE owner = $owner AND id = $record RETURN feedId };
COMMIT TRANSACTION;
RETURN $moved;`;

const moveFeedToFolder = (
  db: Surreal,
  owner: OwnerId,
  id: FeedId,
  folderId: Option.Option<FolderId>
) =>
  run(
    db,
    MOVE,
    { owner, record: toRecord(id), folderId: Option.getOrUndefined(folderId) },
    feedRepositoryError
  ).pipe(
    Effect.map((results) => {
      const moved = results.at(-1);

      return Array.isArray(moved) && moved.length > 0;
    })
  );

const recordFeedSync = (
  db: Surreal,
  owner: OwnerId,
  id: FeedId,
  title: FeedTitle,
  at: DateTime.Utc
) =>
  write(
    db,
    'UPDATE feed SET title = $title, updatedAt = $updatedAt WHERE owner = $owner AND id = $record;',
    { owner, record: toRecord(id), title, updatedAt: DateTime.toDateUtc(at) },
    feedRepositoryError
  );

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
    moveToFolder: (owner, id, folderId) =>
      moveFeedToFolder(db, owner, id, folderId).pipe(lock.withPermit),
    recordSync: (owner, id, title, at) =>
      recordFeedSync(db, owner, id, title, at).pipe(lock.withPermit),
    remove: (owner, ids) => removeFeeds(db, owner, ids).pipe(lock.withPermit),
  });
