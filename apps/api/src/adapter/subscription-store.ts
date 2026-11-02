import { Effect, Option, Schema, type Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import type { Feed } from '../../../../packages/business/src/entity/feed.ts';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import {
  FeedRepository,
  type SubscriptionWriteError,
} from '../../../../packages/business/src/port/feed-repository.ts';
import {
  run,
  subscriptions,
  subscriptionWriteError,
  write,
} from './reader-store-sql';

const FEED_COLUMNS = 'feedId AS id, owner AS ownerId, url, title, updatedAt';

const encodeFeed = (feed: Feed) => ({
  url: Schema.encodeSync(Schema.URLFromString)(feed.url),
  title: feed.title,
  updatedAt: Schema.encodeSync(Schema.DateTimeUtcFromString)(feed.updatedAt),
});

const findSubscription = (db: Surreal, owner: OwnerId, id: FeedId) =>
  subscriptions(
    db,
    `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner AND id = type::record("feed", $id);`,
    { owner, id }
  ).pipe(Effect.map((items) => Option.fromNullishOr(items[0])));

const listSubscriptions = (db: Surreal, owner: OwnerId) =>
  subscriptions(
    db,
    `SELECT ${FEED_COLUMNS} FROM feed WHERE owner = $owner ORDER BY title ASC, feedId ASC;`,
    { owner }
  );

const createSubscription = (db: Surreal, feed: Feed) =>
  run<unknown, SubscriptionWriteError>(
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

const removeSubscription = (db: Surreal, owner: OwnerId, id: FeedId) =>
  write(
    db,
    'BEGIN TRANSACTION; DELETE article WHERE owner = $owner AND feedId = $feedId; DELETE feed WHERE owner = $owner AND id = type::record("feed", $feedId); COMMIT TRANSACTION;',
    { owner, feedId: id },
    subscriptionWriteError
  );

export const makeSubscriptions = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedRepository.of({
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
  });
