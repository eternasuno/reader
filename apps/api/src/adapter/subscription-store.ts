import { createHash } from 'node:crypto';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import type * as Model from '../../../../packages/business/src/entity/model.ts';
import * as Port from '../../../../packages/business/src/port/reader-store.ts';
import {
  read,
  run,
  subscriptionReadError,
  subscriptions,
  subscriptionWriteError,
  write,
} from './reader-store-sql';

export const DEFAULT_RETENTION = 100;

const FEED_COLUMNS = 'feedId AS id, owner AS ownerId, url, title, updatedAt';

const encodeFeed = (feed: Model.Feed) => ({
  url: Schema.encodeSync(Schema.URLFromString)(feed.url),
  title: feed.title,
  updatedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(feed.updatedAt),
});

const findSubscription = (
  db: Surreal,
  owner: Model.OwnerId,
  id: Model.FeedId
) =>
  subscriptions(
    db,
    `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner AND id = type::record("feed", $id);`,
    { owner, id }
  ).pipe(Effect.map((items) => Option.fromNullishOr(items[0])));

const listSubscriptions = (db: Surreal, owner: Model.OwnerId) =>
  subscriptions(
    db,
    `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner ORDER BY title ASC, feedId ASC;`,
    { owner }
  );

const createSubscription = (db: Surreal, feed: Model.Feed) =>
  run<unknown, Port.SubscriptionWriteError>(
    db,
    'BEGIN TRANSACTION; LET $existing = SELECT VALUE id FROM feed WHERE owner = $owner AND (id = type::record("feed", $id) OR url = $url); LET $created = IF array::len($existing) = 0 { UPSERT type::record("feed", $id) SET owner = $owner, feedId = $id, url = $url, title = $title, updatedAt = $updatedAt WHERE owner = NONE RETURN AFTER; } ELSE { []; }; RETURN $created; COMMIT TRANSACTION;',
    { owner: feed.ownerId, id: feed.id, ...encodeFeed(feed) },
    subscriptionWriteError
  ).pipe(
    Effect.map((results) => {
      const created = results[3];

      return Array.isArray(created) && created.length > 0;
    })
  );

const removeSubscription = (
  db: Surreal,
  owner: Model.OwnerId,
  id: Model.FeedId
) =>
  write(
    db,
    'BEGIN TRANSACTION; DELETE article WHERE owner = $owner AND feedId = $feedId; DELETE feed WHERE owner = $owner AND id = type::record("feed", $feedId); COMMIT TRANSACTION;',
    { owner, feedId: id },
    subscriptionWriteError
  );

const RetentionRow = Schema.Struct({ retention: Schema.Int });

const readRetention = (db: Surreal, owner: Model.OwnerId) =>
  read(
    db,
    'SELECT retention FROM reader_setting WHERE owner = $owner;',
    { owner },
    Schema.Array(RetentionRow),
    subscriptionReadError
  ).pipe(Effect.map((rows) => rows[0]?.retention ?? DEFAULT_RETENTION));

export const makeSubscriptions = (db: Surreal, lock: Semaphore.Semaphore) =>
  Port.Subscriptions.of({
    find: (owner, id) => findSubscription(db, owner, id),
    list: (owner) => listSubscriptions(db, owner),
    create: (feed) => createSubscription(db, feed).pipe(lock.withPermit),
    remove: (owner, id) =>
      removeSubscription(db, owner, id).pipe(lock.withPermit),
    update: (feed) =>
      write(
        db,
        'UPDATE type::record("feed", $id) SET url = $url, title = $title, updatedAt = $updatedAt WHERE owner = $owner;',
        { owner: feed.ownerId, id: feed.id, ...encodeFeed(feed) },
        subscriptionWriteError
      ).pipe(lock.withPermit),
    all: subscriptions(
      db,
      `SELECT ${FEED_COLUMNS} FROM feed ORDER BY owner ASC, title ASC, feedId ASC;`,
      {}
    ),
    retention: (owner) => readRetention(db, owner),
    setRetention: (owner, retention) =>
      write(
        db,
        'UPSERT type::record("reader_setting", $id) SET owner = $owner, retention = $retention;',
        {
          owner,
          id: createHash('sha256').update(owner).digest('hex'),
          retention,
        },
        subscriptionWriteError
      ).pipe(lock.withPermit),
  });
