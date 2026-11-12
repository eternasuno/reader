import {
  type ArticleContent,
  FeedId,
  FeedItem,
  FeedItemId,
  type FeedItemPatch,
  type FeedItemQuery,
  FeedItemRepository,
  NormalizedUrl,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  afterClause,
  type Bindings,
  createdIds,
  decodeReturned,
  feedItemRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './reader-store-sql';

const COLUMNS =
  'itemId AS id, owner AS ownerId, feedId, url, title, description, content, extractedContent, publishedAt, read';

const ORDER = 'ORDER BY itemId DESC';

const encodeFeedItem = Schema.encodeSync(FeedItem);

const findFeedItem = (db: Surreal, owner: OwnerId, id: FeedItemId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM feed_item WHERE owner = $owner AND itemId = $id LIMIT 1;`,
    { owner, id },
    FeedItem,
    feedItemRepositoryError
  ).pipe(Effect.map((items) => Option.fromUndefinedOr(items[0])));

type QueryBindings = {
  owner: OwnerId;
  limit: number;
  feedId?: FeedId;
  after?: FeedItemId;
};

const listFeedItems = (db: Surreal, owner: OwnerId, query: FeedItemQuery) => {
  const feedClause = query.feedId === undefined ? '' : ' AND feedId = $feedId';
  const readClause = query.unreadOnly ? ' AND read = false' : '';
  const bindings: QueryBindings = { owner, limit: query.limit };

  if (query.feedId !== undefined) {
    bindings.feedId = query.feedId;
  }

  if (query.after !== undefined) {
    bindings.after = query.after;
  }

  return readRows(
    db,
    `SELECT ${COLUMNS} FROM feed_item WHERE owner = $owner${feedClause}${readClause}${afterClause('itemId', query.after)} ${ORDER} LIMIT $limit;`,
    bindings,
    FeedItem,
    feedItemRepositoryError
  );
};

const insertStatement = (row: string, index: number) => `
LET $f${index} = SELECT VALUE id FROM feed WHERE owner = $owner AND id = type::record("feed", ${row}.feedId);
LET $i${index} = SELECT VALUE id FROM feed_item WHERE id = type::record("feed_item", ${row}.id);
LET $u${index} = SELECT VALUE itemId FROM feed_item WHERE feedId = ${row}.feedId AND url = ${row}.url;
LET $r${index} = IF array::len($f${index}) > 0 AND array::len($i${index}) = 0 AND array::len($u${index}) = 0 { CREATE type::record("feed_item", ${row}.id) SET owner = $owner, feedId = ${row}.feedId, itemId = ${row}.id, url = ${row}.url, title = ${row}.title, description = ${row}.description, content = ${row}.content, extractedContent = ${row}.extractedContent, publishedAt = ${row}.publishedAt, read = ${row}.read } ELSE { [] };
LET $created = array::append($created, array::len($r${index}) > 0);`;

const createFeedItems = (
  db: Surreal,
  owner: OwnerId,
  items: ReadonlyArray<FeedItem>
) => {
  const rows = items.filter((item) => item.ownerId === owner);

  if (rows.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FeedItemId>);
  }

  const bindings: Bindings = { owner };
  rows.forEach((item, index) => {
    bindings[`a${index}`] = encodeFeedItem(item);
  });
  const statements = rows
    .map((_, index) => insertStatement(`$a${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`,
    bindings,
    feedItemRepositoryError
  ).pipe(Effect.map((results) => createdIds(rows, results)));
};

type Assignments = {
  readonly clause: string;
  readonly bindings: Bindings;
};

type PatchBindings = {
  read?: boolean;
  extractedContent?: ArticleContent;
};

const assignments = (patch: FeedItemPatch): Assignments | undefined => {
  const clauses: Array<string> = [];
  const bindings: PatchBindings = {};

  if (patch.read !== undefined) {
    clauses.push('read = $read');
    bindings.read = patch.read;
  }

  if (patch.extractedContent !== undefined) {
    const { extractedContent } = patch;
    clauses.push(
      Option.isNone(extractedContent)
        ? 'extractedContent = NONE'
        : 'extractedContent = $extractedContent'
    );

    if (Option.isSome(extractedContent)) {
      bindings.extractedContent = extractedContent.value;
    }
  }

  return clauses.length === 0
    ? undefined
    : { clause: clauses.join(', '), bindings };
};

const updateFeedItems = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FeedItemId>,
  patch: FeedItemPatch
) => {
  if (ids.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FeedItemId>);
  }

  const set = assignments(patch);
  const statements = [
    'BEGIN TRANSACTION;',
    'LET $matched = SELECT VALUE itemId FROM feed_item WHERE owner = $owner AND id IN $records;',
  ];

  if (set !== undefined) {
    statements.push(
      `UPDATE feed_item SET ${set.clause} WHERE owner = $owner AND id IN $records;`
    );
  }

  statements.push('COMMIT TRANSACTION;', 'RETURN $matched;');

  return run(
    db,
    statements.join(' '),
    { owner, records: recordsOf('feed_item', ids), ...set?.bindings },
    feedItemRepositoryError
  ).pipe(
    Effect.flatMap((results) =>
      decodeReturned(results, Schema.Array(FeedItemId), feedItemRepositoryError)
    )
  );
};

const updateFeedItemsByFeeds = (
  db: Surreal,
  owner: OwnerId,
  feedIds: ReadonlyArray<FeedId>,
  patch: FeedItemPatch
) => {
  const set = assignments(patch);

  if (feedIds.length === 0 || set === undefined) {
    return Effect.void;
  }

  return write(
    db,
    `UPDATE feed_item SET ${set.clause} WHERE owner = $owner AND feedId IN $feedIds;`,
    { owner, feedIds: [...feedIds], ...set.bindings },
    feedItemRepositoryError
  );
};

const updateAllFeedItems = (
  db: Surreal,
  owner: OwnerId,
  patch: FeedItemPatch
) => {
  const set = assignments(patch);

  return set === undefined
    ? Effect.void
    : write(
        db,
        `UPDATE feed_item SET ${set.clause} WHERE owner = $owner;`,
        { owner, ...set.bindings },
        feedItemRepositoryError
      );
};

const UnreadCountRow = Schema.Struct({
  feedId: FeedId,
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const readUnreadCounts = (db: Surreal, owner: OwnerId) =>
  readRows(
    db,
    'SELECT feedId, count() AS total FROM feed_item WHERE owner = $owner AND read = false GROUP BY feedId ORDER BY feedId;',
    { owner },
    UnreadCountRow,
    feedItemRepositoryError
  ).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({ feedId: row.feedId, count: row.total }))
    )
  );

const FeedItemKeyRow = Schema.Struct({
  id: FeedItemId,
  url: NormalizedUrl,
});

const readInventory = (db: Surreal, owner: OwnerId, feedId: FeedId) =>
  readRows(
    db,
    `SELECT itemId AS id, url FROM feed_item WHERE owner = $owner AND feedId = $feedId ${ORDER};`,
    { owner, feedId },
    FeedItemKeyRow,
    feedItemRepositoryError
  );

const removeFeedItems = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FeedItemId>
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'DELETE feed_item WHERE owner = $owner AND id IN $records;',
        { owner, records: recordsOf('feed_item', ids) },
        feedItemRepositoryError
      );

export const makeFeedItems = (db: Surreal, lock: Semaphore.Semaphore) =>
  FeedItemRepository.of({
    find: (owner, id) => findFeedItem(db, owner, id),
    list: (owner, query) => listFeedItems(db, owner, query),
    create: (owner, items) =>
      createFeedItems(db, owner, items).pipe(lock.withPermit),
    update: (owner, ids, patch) =>
      updateFeedItems(db, owner, ids, patch).pipe(lock.withPermit),
    updateByFeeds: (owner, feedIds, patch) =>
      updateFeedItemsByFeeds(db, owner, feedIds, patch).pipe(lock.withPermit),
    updateAll: (owner, patch) =>
      updateAllFeedItems(db, owner, patch).pipe(lock.withPermit),
    unreadCounts: (owner) => readUnreadCounts(db, owner),
    inventory: (owner, feedId) => readInventory(db, owner, feedId),
    remove: (owner, ids) =>
      removeFeedItems(db, owner, ids).pipe(lock.withPermit),
  });
