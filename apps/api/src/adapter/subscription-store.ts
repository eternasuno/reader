import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import type { Feed } from '../../../../packages/business/src/entity/feed.ts';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import {
  type FeedPatch,
  FeedRepository,
  type FeedRepositoryError,
  type FeedUpdate,
} from '../../../../packages/business/src/port/feed-repository.ts';
import {
  type Bindings,
  feedRepositoryError,
  run,
  subscriptions,
  write,
} from './reader-store-sql';

const FEED_COLUMNS = 'feedId AS id, owner AS ownerId, url, title, updatedAt';

const encodeUrl = Schema.encodeSync(Schema.URLFromString);

const encodeFeed = (feed: Feed) => ({
  id: feed.id,
  url: encodeUrl(feed.url),
  title: feed.title,
  updatedAt: DateTime.toDateUtc(feed.updatedAt),
});

type PatchField = {
  readonly column: 'url' | 'title' | 'updatedAt';
  readonly value: unknown;
};

const patchFields = (feedPatch: FeedPatch): readonly PatchField[] => {
  const fields: PatchField[] = [];

  if (feedPatch.url !== undefined) {
    fields.push({ column: 'url', value: encodeUrl(feedPatch.url) });
  }

  if (feedPatch.title !== undefined) {
    fields.push({ column: 'title', value: feedPatch.title });
  }

  if (feedPatch.updatedAt !== undefined) {
    fields.push({
      column: 'updatedAt',
      value: DateTime.toDateUtc(feedPatch.updatedAt),
    });
  }

  return fields;
};

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

const createSubscriptions = (
  db: Surreal,
  owner: OwnerId,
  items: readonly Feed[]
) => {
  if (items.length === 0) {
    return Effect.succeed([] as readonly FeedId[]);
  }

  const bindings: Bindings = { owner };
  items.forEach((item, index) => {
    bindings[`f${index}`] = encodeFeed(item);
  });
  const statements = items
    .map((_, index) => {
      const row = `$f${index}`;

      return `LET $existing${index} = SELECT VALUE id FROM feed WHERE owner = $owner AND (id = type::record("feed", ${row}.id) OR url = ${row}.url); LET $rows${index} = IF array::len($existing${index}) = 0 { UPSERT type::record("feed", ${row}.id) SET owner = $owner, feedId = ${row}.id, url = ${row}.url, title = ${row}.title, updatedAt = ${row}.updatedAt WHERE owner = NONE RETURN AFTER; } ELSE { [] }; LET $created = array::concat($created, [array::len($rows${index}) > 0]);`;
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

const updateSubscriptions = (
  db: Surreal,
  owner: OwnerId,
  updates: readonly FeedUpdate[]
) => {
  const bindings: Bindings = { owner };
  const statements = updates.flatMap((update, index) => {
    const fields = patchFields(update.feedPatch);
    if (fields.length === 0) {
      return [];
    }

    bindings[`id${index}`] = update.id;
    const assignments = fields
      .map((field) => {
        const parameter = `p${index}${field.column}`;
        bindings[parameter] = field.value;

        return `${field.column} = $${parameter}`;
      })
      .join(', ');

    return [
      `UPDATE type::record("feed", $id${index}) SET ${assignments} WHERE owner = $owner;`,
    ];
  });

  if (statements.length === 0) {
    return Effect.void;
  }

  return write(
    db,
    `BEGIN TRANSACTION; ${statements.join(' ')} COMMIT TRANSACTION;`,
    bindings,
    feedRepositoryError
  );
};

export const makeSubscriptions = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedRepository.of({
    find: (owner, id) => findSubscription(db, owner, id),
    list: (owner) => listSubscriptions(db, owner),
    create: (owner, feeds) =>
      createSubscriptions(db, owner, feeds).pipe(lock.withPermit),
    remove: (owner, ids) =>
      removeSubscriptions(db, owner, ids).pipe(lock.withPermit),
    update: (owner, updates) =>
      updateSubscriptions(db, owner, updates).pipe(lock.withPermit),
  });
