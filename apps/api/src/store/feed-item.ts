import {
  type ArticleContent,
  FeedId,
  FeedItem,
  FeedItemId,
  type FeedItemQuery,
  FeedItemRepository,
  FeedItemRepositoryError,
  type FolderId,
  type IFeedItemRepository,
  NormalizedUrl,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { SqlClient, type SqlError, type Statement } from 'effect/sql';
import {
  createEach,
  cursorClause,
  dateFromMillis,
  decodeRows,
  inList,
  unreadClause,
} from './sql';

type Sql = SqlClient.SqlClient;

type Row = Readonly<Record<string, unknown>>;

const feedItemRepositoryError = () =>
  new FeedItemRepositoryError({ message: 'Failed to access feed items' });

const fail = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
  effect.pipe(Effect.mapError(feedItemRepositoryError));

const COLUMNS =
  'id, owner AS ownerId, feed_id AS feedId, url, title, description, content, extracted_content AS extractedContent, published_at AS publishedAt, read';

const ORDER = 'ORDER BY id DESC';

const storedRow = (row: Row): Row => ({
  ...row,
  publishedAt: dateFromMillis(row['publishedAt']),
  read: row['read'] === 1,
});

const decodeItems = (rows: ReadonlyArray<Row>) =>
  decodeRows(rows.map(storedRow), FeedItem, feedItemRepositoryError);

const findFeedItem = (sql: Sql, owner: OwnerId, id: FeedItemId) =>
  sql`SELECT ${sql.literal(COLUMNS)} FROM feed_item WHERE owner = ${owner} AND id = ${id} LIMIT 1`.pipe(
    fail,
    Effect.flatMap(decodeItems),
    Effect.map((items) => Option.fromUndefinedOr(items[0]))
  );

const listFeedItems = (
  sql: Sql,
  owner: OwnerId,
  query: FeedItemQuery,
  scope: Statement.Fragment
) =>
  sql`SELECT ${sql.literal(COLUMNS)} FROM feed_item WHERE owner = ${owner}${scope}${unreadClause(sql, query.unreadOnly)}${cursorClause(sql, query.after)} ${sql.literal(ORDER)} LIMIT ${query.limit}`.pipe(
    fail,
    Effect.flatMap(decodeItems)
  );

const listAll = (sql: Sql, owner: OwnerId, query: FeedItemQuery) =>
  listFeedItems(sql, owner, query, sql.literal(''));

const listByFeed = (
  sql: Sql,
  owner: OwnerId,
  feedId: FeedId,
  query: FeedItemQuery
) => listFeedItems(sql, owner, query, sql` AND feed_id = ${feedId}`);

const listByFolder = (
  sql: Sql,
  owner: OwnerId,
  folderId: FolderId,
  query: FeedItemQuery
) =>
  listFeedItems(
    sql,
    owner,
    query,
    sql` AND feed_id IN (SELECT id FROM feed WHERE owner = ${owner} AND folder_id = ${folderId})`
  );

const encodeFeedItem = Schema.encodeSync(FeedItem);

const itemValues = (row: FeedItem) => {
  const encoded = encodeFeedItem(row);

  return {
    id: encoded.id,
    owner: encoded.ownerId,
    feedId: encoded.feedId,
    url: encoded.url,
    title: encoded.title,
    description: encoded.description ?? null,
    content: encoded.content ?? null,
    extractedContent: encoded.extractedContent ?? null,
    publishedAt:
      encoded.publishedAt === undefined ? null : encoded.publishedAt.getTime(),
    read: encoded.read ? 1 : 0,
  };
};

const insertItem = (sql: Sql) => (row: FeedItem) => {
  const value = itemValues(row);

  return sql`INSERT INTO feed_item (id, owner, feed_id, url, title, description, content, extracted_content, published_at, read) SELECT ${value.id}, ${value.owner}, ${value.feedId}, ${value.url}, ${value.title}, ${value.description}, ${value.content}, ${value.extractedContent}, ${value.publishedAt}, ${value.read} WHERE EXISTS (SELECT 1 FROM feed WHERE owner = ${value.owner} AND id = ${value.feedId}) ON CONFLICT DO NOTHING RETURNING id`;
};

const createFeedItems = (
  sql: Sql,
  owner: OwnerId,
  items: ReadonlyArray<FeedItem>
) => createEach(sql, owner, items, insertItem(sql)).pipe(fail);

const markFeedItems = (
  sql: Sql,
  owner: OwnerId,
  ids: ReadonlyArray<FeedItemId>,
  read: boolean
) =>
  ids.length === 0
    ? Effect.void
    : sql`UPDATE feed_item SET read = ${read ? 1 : 0} WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        fail,
        Effect.asVoid
      );

const markFeedItemsByFeeds = (
  sql: Sql,
  owner: OwnerId,
  feedIds: ReadonlyArray<FeedId>
) =>
  feedIds.length === 0
    ? Effect.void
    : sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner} AND ${inList(sql, 'feed_id', feedIds)}`.pipe(
        fail,
        Effect.asVoid
      );

const markFeedItemsByFolders = (
  sql: Sql,
  owner: OwnerId,
  folderIds: ReadonlyArray<FolderId>
) =>
  folderIds.length === 0
    ? Effect.void
    : sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner} AND feed_id IN (SELECT id FROM feed WHERE owner = ${owner} AND ${inList(sql, 'folder_id', folderIds)})`.pipe(
        fail,
        Effect.asVoid
      );

const markAllFeedItems = (sql: Sql, owner: OwnerId) =>
  sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner}`.pipe(
    fail,
    Effect.asVoid
  );

const setExtractedContent = (
  sql: Sql,
  owner: OwnerId,
  id: FeedItemId,
  content: ArticleContent
) =>
  sql`UPDATE feed_item SET extracted_content = ${content} WHERE owner = ${owner} AND id = ${id} RETURNING id`.pipe(
    fail,
    Effect.map((rows) => rows.length > 0)
  );

const UnreadCountRow = Schema.Struct({
  feedId: FeedId,
  count: Schema.Int,
});

const readUnreadCounts = (sql: Sql, owner: OwnerId) =>
  sql`SELECT feed_id AS feedId, count(*) AS count FROM feed_item WHERE owner = ${owner} AND read = 0 GROUP BY feed_id ORDER BY feed_id`.pipe(
    fail,
    Effect.flatMap((rows) =>
      decodeRows(rows, UnreadCountRow, feedItemRepositoryError)
    )
  );

const FeedItemKeyRow = Schema.Struct({
  id: FeedItemId,
  url: NormalizedUrl,
});

const readInventory = (sql: Sql, owner: OwnerId, feedId: FeedId) =>
  sql`SELECT id, url FROM feed_item WHERE owner = ${owner} AND feed_id = ${feedId} ${sql.literal(ORDER)}`.pipe(
    fail,
    Effect.flatMap((rows) =>
      decodeRows(rows, FeedItemKeyRow, feedItemRepositoryError)
    )
  );

const removeFeedItems = (
  sql: Sql,
  owner: OwnerId,
  ids: ReadonlyArray<FeedItemId>
) =>
  ids.length === 0
    ? Effect.void
    : sql`DELETE FROM feed_item WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        fail,
        Effect.asVoid
      );

export const makeFeedItemRepository: Effect.Effect<
  IFeedItemRepository,
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return FeedItemRepository.of({
    find: (owner, id) => findFeedItem(sql, owner, id),
    listAll: (owner, query) => listAll(sql, owner, query),
    listByFeed: (owner, feedId, query) => listByFeed(sql, owner, feedId, query),
    listByFolder: (owner, folderId, query) =>
      listByFolder(sql, owner, folderId, query),
    create: (owner, items) => createFeedItems(sql, owner, items),
    markRead: (owner, ids, read) => markFeedItems(sql, owner, ids, read),
    markReadByFeeds: (owner, feedIds) =>
      markFeedItemsByFeeds(sql, owner, feedIds),
    markReadByFolders: (owner, folderIds) =>
      markFeedItemsByFolders(sql, owner, folderIds),
    markAllRead: (owner) => markAllFeedItems(sql, owner),
    setExtractedContent: (owner, id, content) =>
      setExtractedContent(sql, owner, id, content),
    unreadCounts: (owner) => readUnreadCounts(sql, owner),
    inventory: (owner, feedId) => readInventory(sql, owner, feedId),
    remove: (owner, ids) => removeFeedItems(sql, owner, ids),
  });
});
