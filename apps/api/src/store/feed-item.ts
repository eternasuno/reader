import {
  type ArticleContent,
  FeedId,
  FeedItem,
  FeedItemId,
  type FeedItemQuery,
  FeedItemRepository,
  type FolderId,
  NormalizedUrl,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  afterClause,
  type Bindings,
  createRows,
  feedItemRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './sql';

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
  folderId?: FolderId;
  after?: FeedItemId;
};

type Scope = {
  readonly clause: string;
  readonly bindings: Bindings;
};

const listFeedItems = (
  db: Surreal,
  owner: OwnerId,
  query: FeedItemQuery,
  scope: Scope
) => {
  const readClause = query.unreadOnly ? ' AND read = false' : '';
  const bindings: QueryBindings = {
    ...scope.bindings,
    owner,
    limit: query.limit,
  };

  if (query.after !== undefined) {
    bindings.after = query.after;
  }

  return readRows(
    db,
    `SELECT ${COLUMNS} FROM feed_item WHERE owner = $owner${scope.clause}${readClause}${afterClause('itemId', query.after)} ${ORDER} LIMIT $limit;`,
    bindings,
    FeedItem,
    feedItemRepositoryError
  );
};

const listAll = (db: Surreal, owner: OwnerId, query: FeedItemQuery) =>
  listFeedItems(db, owner, query, { clause: '', bindings: {} });

const listByFeed = (
  db: Surreal,
  owner: OwnerId,
  feedId: FeedId,
  query: FeedItemQuery
) =>
  listFeedItems(db, owner, query, {
    clause: ' AND feedId = $feedId',
    bindings: { feedId },
  });

const listByFolder = (
  db: Surreal,
  owner: OwnerId,
  folderId: FolderId,
  query: FeedItemQuery
) =>
  listFeedItems(db, owner, query, {
    clause:
      ' AND feedId IN (SELECT VALUE feedId FROM feed WHERE owner = $owner AND folderId = $folderId)',
    bindings: { folderId },
  });

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
) =>
  createRows(db, owner, items, {
    prefix: 'a',
    encode: encodeFeedItem,
    statement: insertStatement,
    onError: feedItemRepositoryError,
  });

const markFeedItems = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FeedItemId>,
  read: boolean
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'UPDATE feed_item SET read = $read WHERE owner = $owner AND id IN $records;',
        { owner, read, records: recordsOf('feed_item', ids) },
        feedItemRepositoryError
      );

const markFeedItemsByFeeds = (
  db: Surreal,
  owner: OwnerId,
  feedIds: ReadonlyArray<FeedId>
) =>
  feedIds.length === 0
    ? Effect.void
    : write(
        db,
        'UPDATE feed_item SET read = true WHERE owner = $owner AND feedId IN $feedIds;',
        { owner, feedIds: [...feedIds] },
        feedItemRepositoryError
      );

const markFeedItemsByFolders = (
  db: Surreal,
  owner: OwnerId,
  folderIds: ReadonlyArray<FolderId>
) =>
  folderIds.length === 0
    ? Effect.void
    : write(
        db,
        'UPDATE feed_item SET read = true WHERE owner = $owner AND feedId IN (SELECT VALUE feedId FROM feed WHERE owner = $owner AND folderId IN $folderIds);',
        { owner, folderIds: [...folderIds] },
        feedItemRepositoryError
      );

const markAllFeedItems = (db: Surreal, owner: OwnerId) =>
  write(
    db,
    'UPDATE feed_item SET read = true WHERE owner = $owner;',
    { owner },
    feedItemRepositoryError
  );

const setExtractedContent = (
  db: Surreal,
  owner: OwnerId,
  id: FeedItemId,
  content: ArticleContent
) =>
  run(
    db,
    'UPDATE feed_item SET extractedContent = $content WHERE owner = $owner AND id = $record RETURN itemId;',
    { owner, content, record: new RecordId('feed_item', id) },
    feedItemRepositoryError
  ).pipe(
    Effect.map((results) => {
      const rows = results[0];

      return Array.isArray(rows) && rows.length > 0;
    })
  );

const UnreadCountRow = Schema.Struct({
  feedId: FeedId,
  total: Schema.Int,
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

export const makeFeedItemRepository = (
  db: Surreal,
  lock: Semaphore.Semaphore
) =>
  FeedItemRepository.of({
    find: (owner, id) => findFeedItem(db, owner, id),
    listAll: (owner, query) => listAll(db, owner, query),
    listByFeed: (owner, feedId, query) => listByFeed(db, owner, feedId, query),
    listByFolder: (owner, folderId, query) =>
      listByFolder(db, owner, folderId, query),
    create: (owner, items) =>
      createFeedItems(db, owner, items).pipe(lock.withPermit),
    markRead: (owner, ids, read) =>
      markFeedItems(db, owner, ids, read).pipe(lock.withPermit),
    markReadByFeeds: (owner, feedIds) =>
      markFeedItemsByFeeds(db, owner, feedIds).pipe(lock.withPermit),
    markReadByFolders: (owner, folderIds) =>
      markFeedItemsByFolders(db, owner, folderIds).pipe(lock.withPermit),
    markAllRead: (owner) => markAllFeedItems(db, owner).pipe(lock.withPermit),
    setExtractedContent: (owner, id, content) =>
      setExtractedContent(db, owner, id, content).pipe(lock.withPermit),
    unreadCounts: (owner) => readUnreadCounts(db, owner),
    inventory: (owner, feedId) => readInventory(db, owner, feedId),
    remove: (owner, ids) =>
      removeFeedItems(db, owner, ids).pipe(lock.withPermit),
  });
