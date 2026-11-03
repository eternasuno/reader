import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import type { Feed } from '../../../../packages/business/src/entity/feed.ts';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../../../packages/business/src/port/feed-repository.ts';
import {
  type Bindings,
  feedRepositoryError,
  run,
  subscriptions,
  write,
} from './reader-store-sql';

const FEED_COLUMNS = 'feedId AS id, owner AS ownerId, url, title, updatedAt';

const encodeFeed = (feed: Feed) => ({
  id: feed.id,
  ownerId: feed.ownerId,
  url: Schema.encodeSync(Schema.URLFromString)(feed.url),
  title: feed.title,
  updatedAt: DateTime.toDateUtc(feed.updatedAt),
});

const findSubscription = (db: Surreal, owner: OwnerId, id: FeedId) =>
  subscriptions(
    db,
    `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner AND id = type::record("feed", $id);`,
    { owner, id }
  ).pipe(Effect.map((items) => Option.fromNullishOr(items[0])));

const listSubscriptions = (db: Surreal, owner?: OwnerId) =>
  subscriptions(
    db,
    owner === undefined
      ? `SELECT ${FEED_COLUMNS} FROM feed ORDER BY owner ASC, title ASC, feedId ASC;`
      : `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner ORDER BY title ASC, feedId ASC;`,
    owner === undefined ? {} : { owner }
  );

const createSubscriptions = (db: Surreal, items: readonly Feed[]) => {
  if (items.length === 0) {
    return Effect.succeed([] as readonly FeedId[]);
  }

  const bindings: Bindings = {};
  items.forEach((item, index) => {
    bindings[`f${index}`] = encodeFeed(item);
  });
  const statements = items
    .map((_, index) => {
      const row = `$f${index}`;

      return `LET $existing${index} = SELECT VALUE id FROM feed WHERE owner = ${row}.ownerId AND (id = type::record("feed", ${row}.id) OR url = ${row}.url); LET $rows${index} = IF array::len($existing${index}) = 0 { UPSERT type::record("feed", ${row}.id) SET owner = ${row}.ownerId, feedId = ${row}.id, url = ${row}.url, title = ${row}.title, updatedAt = ${row}.updatedAt WHERE owner = NONE RETURN AFTER; } ELSE { [] }; LET $created = array::concat($created, [array::len($rows${index}) > 0]);`;
    })
    .join(' ');
  const sql = `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`;

  return run<unknown, FeedRepositoryError>(
    db,
    sql,
    bindings,
    feedRepositoryError
  ).pipe(
    Effect.map((results) => {
      const flags = results.at(-1);
      const created = Array.isArray(flags) ? flags : [];

      return items.flatMap((item, index) =>
        created[index] === true ? [item.id] : []
      );
    })
  );
};

const removeSubscriptions = (
  db: Surreal,
  owner: OwnerId,
  ids: readonly FeedId[]
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'BEGIN TRANSACTION; DELETE article WHERE owner = $owner AND feedId IN $ids; DELETE feed WHERE owner = $owner AND id IN $records; COMMIT TRANSACTION;',
        {
          owner,
          ids,
          records: ids.map((id) => new RecordId('feed', id)),
        },
        feedRepositoryError
      );

const updateSubscriptions = (db: Surreal, items: readonly Feed[]) => {
  if (items.length === 0) {
    return Effect.void;
  }

  const bindings: Bindings = {};
  items.forEach((item, index) => {
    bindings[`f${index}`] = encodeFeed(item);
  });
  const statements = items
    .map(
      (_, index) =>
        `UPDATE type::record("feed", $f${index}.id) SET url = $f${index}.url, title = $f${index}.title, updatedAt = $f${index}.updatedAt WHERE owner = $f${index}.ownerId;`
    )
    .join(' ');
  const sql = `BEGIN TRANSACTION; ${statements} COMMIT TRANSACTION;`;

  return write(db, sql, bindings, feedRepositoryError);
};

export const makeSubscriptions = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedRepository.of({
    find: (owner, id) => findSubscription(db, owner, id),
    list: (owner) => listSubscriptions(db, owner),
    create: (feeds) => createSubscriptions(db, feeds).pipe(lock.withPermit),
    remove: (owner, ids) =>
      removeSubscriptions(db, owner, ids).pipe(lock.withPermit),
    update: (feeds) => updateSubscriptions(db, feeds).pipe(lock.withPermit),
  });
