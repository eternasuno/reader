import {
  FeedId,
  FeedItem,
  FeedItemId,
  type FeedItemPatch,
  type FeedItemQuery,
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '@reader/business';
import { DateTime, Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  type Bindings,
  feedItemRepositoryError,
  feedItems,
  one,
  read,
  run,
  write,
} from './reader-store-sql';

const COLUMNS =
  'itemId AS id, feedId, url, title, description, content, extractedContent, publishedAt, read';

const encodeFeedItem = Schema.encodeSync(FeedItem);

const createFeedItems = (db: Surreal, items: ReadonlyArray<FeedItem>) => {
  if (items.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FeedItemId>);
  }

  const feedIds = [...new Set(items.map((item) => item.feedId))];
  const bindings: Bindings = {
    ids: feedIds.map((id) => new RecordId('feed', id)),
    count: feedIds.length,
  };
  items.forEach((item, index) => {
    bindings[`a${index}`] = encodeFeedItem(item);
  });
  const inserts = items
    .map(
      (_, index) =>
        `UPSERT type::record("feed_item", $a${index}.id) SET itemId = $a${index}.id, feedId = $a${index}.feedId, url = $a${index}.url, title = $a${index}.title, description = $a${index}.description, content = $a${index}.content, extractedContent = $a${index}.extractedContent, publishedAt = $a${index}.publishedAt, read = $a${index}.read WHERE feedId = NONE RETURN AFTER;`
    )
    .join(' ');
  const sql = `BEGIN TRANSACTION; LET $feeds = SELECT VALUE id FROM feed WHERE id IN $ids; IF array::len($feeds) != $count { THROW "Subscription not found"; }; ${inserts} COMMIT TRANSACTION;`;

  return run<unknown, FeedItemRepositoryError>(
    db,
    sql,
    bindings,
    feedItemRepositoryError
  ).pipe(
    Effect.map((results) =>
      items.flatMap((item, index) => {
        const created = results[index + 3];

        return Array.isArray(created) && created.length > 0 ? [item.id] : [];
      })
    )
  );
};

const patchSet = (patch: FeedItemPatch) => {
  const fields: Array<string> = [];
  const bindings: { read?: boolean; extractedContent?: string } = {};

  if (patch.read !== undefined) {
    fields.push('read = $read');
    bindings.read = patch.read;
  }

  if (patch.extractedContent !== undefined) {
    if (Option.isNone(patch.extractedContent)) {
      fields.push('extractedContent = NONE');
    } else {
      fields.push('extractedContent = $extractedContent');
      bindings.extractedContent = patch.extractedContent.value;
    }
  }

  return fields.length === 0
    ? undefined
    : { clause: fields.join(', '), bindings };
};

const updateWhere = (
  db: Surreal,
  clause: string,
  scopeBindings: Bindings,
  patch: FeedItemPatch
) => {
  const set = patchSet(patch);

  return set === undefined
    ? Effect.succeed([] as ReadonlyArray<FeedItemId>)
    : one<Array<{ itemId: FeedItemId }>, FeedItemRepositoryError>(
        db,
        `UPDATE feed_item SET ${set.clause} WHERE ${clause} RETURN AFTER;`,
        { ...scopeBindings, ...set.bindings },
        feedItemRepositoryError
      ).pipe(Effect.map((rows) => rows.map((row) => row.itemId)));
};

const filterClause = (filter: FeedItemQuery['filter']) =>
  filter === 'all' ? '' : ' AND read = $read';

const boundaryClauses = (query: FeedItemQuery) => {
  const after =
    query.after === undefined
      ? ''
      : ' AND (publishedAt < $afterAt OR (publishedAt = $afterAt AND itemId > $afterId))';
  const through =
    query.through === undefined
      ? ''
      : ' AND (publishedAt > $throughAt OR (publishedAt = $throughAt AND itemId <= $throughId))';

  return `${after}${through}`;
};

const pageBindings = (
  feedIds: ReadonlyArray<FeedId>,
  query: FeedItemQuery
): Bindings => ({
  feedIds: [...feedIds],
  limit: query.limit,
  ...(query.filter === 'all' ? {} : { read: query.filter === 'read' }),
  ...(query.after === undefined
    ? {}
    : {
        afterAt: DateTime.toDate(query.after.publishedAt),
        afterId: query.after.id,
      }),
  ...(query.through === undefined
    ? {}
    : {
        throughAt: DateTime.toDate(query.through.publishedAt),
        throughId: query.through.id,
      }),
});

const listFeedItems = (
  db: Surreal,
  feedIds: ReadonlyArray<FeedId>,
  query: FeedItemQuery
) =>
  feedIds.length === 0
    ? Effect.succeed([] as ReadonlyArray<FeedItem>)
    : feedItems(
        db,
        `SELECT ${COLUMNS} FROM feed_item WHERE feedId IN $feedIds${filterClause(query.filter)}${boundaryClauses(query)} ORDER BY publishedAt DESC, itemId ASC LIMIT $limit;`,
        pageBindings(feedIds, query)
      );

const UnreadRow = Schema.Struct({
  feedId: FeedId,
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const BoundaryRow = Schema.Struct({
  publishedAt: Schema.DateTimeUtcFromDate,
  id: FeedItemId,
});

const readUnreadCounts = (db: Surreal, feedIds: ReadonlyArray<FeedId>) =>
  feedIds.length === 0
    ? Effect.succeed([] as ReadonlyArray<{ feedId: FeedId; count: number }>)
    : read(
        db,
        'SELECT feedId, count() AS total FROM feed_item WHERE feedId IN $feedIds AND read = false GROUP BY feedId;',
        { feedIds: [...feedIds] },
        Schema.Array(UnreadRow),
        feedItemRepositoryError
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({ feedId: row.feedId, count: row.total }))
        )
      );

const readQueries = (db: Surreal) => ({
  find: (feedId: FeedId, id: FeedItemId) =>
    feedItems(
      db,
      `SELECT ${COLUMNS} FROM feed_item WHERE feedId = $feedId AND id = type::record("feed_item", $id);`,
      { feedId, id }
    ).pipe(Effect.map((items) => Option.fromNullishOr(items[0]))),
  list: (feedIds: ReadonlyArray<FeedId>, query: FeedItemQuery) =>
    listFeedItems(db, feedIds, query),
  unreadCounts: (feedIds: ReadonlyArray<FeedId>) =>
    readUnreadCounts(db, feedIds),
  inventory: (feedId: FeedId) =>
    read(
      db,
      'SELECT publishedAt, itemId AS id FROM feed_item WHERE feedId = $feedId ORDER BY publishedAt DESC, itemId ASC;',
      { feedId },
      Schema.Array(BoundaryRow),
      feedItemRepositoryError
    ),
});

const writeCommands = (db: Surreal, lock: Semaphore.Semaphore) => ({
  create: (items: ReadonlyArray<FeedItem>) =>
    createFeedItems(db, items).pipe(lock.withPermit),
  update: (
    feedId: FeedId,
    ids: ReadonlyArray<FeedItemId>,
    patch: FeedItemPatch
  ) =>
    (ids.length === 0
      ? Effect.succeed([] as ReadonlyArray<FeedItemId>)
      : updateWhere(
          db,
          'feedId = $feedId AND itemId IN $ids',
          { feedId, ids },
          patch
        )
    ).pipe(lock.withPermit),
  updateByFeeds: (feedIds: ReadonlyArray<FeedId>, patch: FeedItemPatch) =>
    (feedIds.length === 0
      ? Effect.succeed([] as ReadonlyArray<FeedItemId>)
      : updateWhere(db, 'feedId IN $feedIds', { feedIds: [...feedIds] }, patch)
    ).pipe(lock.withPermit),
  retain: (feedId: FeedId, ids: ReadonlyArray<FeedItemId>) =>
    write(
      db,
      ids.length === 0
        ? 'DELETE feed_item WHERE feedId = $feedId;'
        : 'DELETE feed_item WHERE feedId = $feedId AND itemId NOT IN $ids;',
      { feedId, ids },
      feedItemRepositoryError
    ).pipe(lock.withPermit),
});

export const makeFeedItems = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedItemRepository.of({
    ...readQueries(db),
    ...writeCommands(db, lock),
  });
