import {
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
import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import {
  changed,
  createEach,
  dateFromMillis,
  decodeRows,
  failWith,
  first,
  inList,
  millisOrNull,
  page,
} from './sql';

const fail = failWith(
  () => new FeedItemRepositoryError({ message: 'Failed to access feed items' })
);

const decodeItems = decodeRows(FeedItem, ({ publishedAt, read, ...row }) => ({
  ...row,
  publishedAt: dateFromMillis(publishedAt),
  read: read === 1,
}));

const decodeUnreadCounts = decodeRows(
  Schema.Struct({ feedId: FeedId, count: Schema.Int })
);

const decodeKeys = decodeRows(
  Schema.Struct({ id: FeedItemId, url: NormalizedUrl })
);

const SELECT =
  'SELECT id, owner AS ownerId, feed_id AS feedId, url, title, description, content, extracted_content AS extractedContent, published_at AS publishedAt, read FROM feed_item';

export const listAllStatement = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  query: FeedItemQuery
) => sql`${sql.literal(SELECT)} WHERE owner = ${owner}${page(sql, query)}`;

export const listByFeedStatement = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  feedId: FeedId,
  query: FeedItemQuery
) =>
  sql`${sql.literal(SELECT)} WHERE owner = ${owner} AND feed_id = ${feedId}${page(sql, query)}`;

export const listByFolderStatement = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  folderId: FolderId,
  query: FeedItemQuery
) =>
  sql`${sql.literal(SELECT)} WHERE owner = ${owner} AND feed_id IN (SELECT id FROM feed WHERE owner = ${owner} AND folder_id = ${folderId})${page(sql, query)}`;

const reads = (sql: SqlClient.SqlClient) => {
  const select = sql.literal(SELECT);

  return {
    find: (owner, id) =>
      sql`${select} WHERE owner = ${owner} AND id = ${id}`.pipe(
        Effect.flatMap(decodeItems),
        Effect.map(first),
        fail
      ),
    listAll: (owner, query) =>
      listAllStatement(sql, owner, query).pipe(
        Effect.flatMap(decodeItems),
        fail
      ),
    listByFeed: (owner, feedId, query) =>
      listByFeedStatement(sql, owner, feedId, query).pipe(
        Effect.flatMap(decodeItems),
        fail
      ),
    listByFolder: (owner, folderId, query) =>
      listByFolderStatement(sql, owner, folderId, query).pipe(
        Effect.flatMap(decodeItems),
        fail
      ),
    unreadCounts: (owner) =>
      sql`SELECT feed_id AS feedId, count(*) AS count FROM feed_item WHERE owner = ${owner} AND read = 0 GROUP BY feed_id ORDER BY feed_id`.pipe(
        Effect.flatMap(decodeUnreadCounts),
        fail
      ),
    inventory: (owner, feedId) =>
      sql`SELECT id, url FROM feed_item WHERE owner = ${owner} AND feed_id = ${feedId} ORDER BY id DESC`.pipe(
        Effect.flatMap(decodeKeys),
        fail
      ),
  } satisfies Partial<IFeedItemRepository>;
};

const writes = (sql: SqlClient.SqlClient) =>
  ({
    create: (owner, items) =>
      createEach(
        sql,
        owner,
        items,
        (item) =>
          sql`INSERT INTO feed_item (id, owner, feed_id, url, title, description, content, extracted_content, published_at, read) SELECT ${item.id}, ${item.ownerId}, ${item.feedId}, ${item.url.href}, ${item.title}, ${Option.getOrNull(item.description)}, ${Option.getOrNull(item.content)}, ${Option.getOrNull(item.extractedContent)}, ${millisOrNull(item.publishedAt)}, ${item.read ? 1 : 0} WHERE EXISTS (SELECT 1 FROM feed WHERE owner = ${item.ownerId} AND id = ${item.feedId}) ON CONFLICT DO NOTHING RETURNING id`
      ).pipe(fail),
    markRead: (owner, ids, read) =>
      sql`UPDATE feed_item SET read = ${read ? 1 : 0} WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        fail
      ),
    markReadByFeeds: (owner, feedIds) =>
      sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner} AND ${inList(sql, 'feed_id', feedIds)}`.pipe(
        Effect.asVoid,
        fail
      ),
    markReadByFolders: (owner, folderIds) =>
      sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner} AND feed_id IN (SELECT id FROM feed WHERE owner = ${owner} AND ${inList(sql, 'folder_id', folderIds)})`.pipe(
        Effect.asVoid,
        fail
      ),
    markAllRead: (owner) =>
      sql`UPDATE feed_item SET read = 1 WHERE owner = ${owner}`.pipe(
        Effect.asVoid,
        fail
      ),
    setExtractedContent: (owner, id, content) =>
      sql`UPDATE feed_item SET extracted_content = ${content} WHERE owner = ${owner} AND id = ${id} RETURNING id`.pipe(
        Effect.map(changed),
        fail
      ),
    remove: (owner, ids) =>
      sql`DELETE FROM feed_item WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        fail
      ),
  }) satisfies Partial<IFeedItemRepository>;

export const FeedItemRepositoryLive = Layer.effect(
  FeedItemRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return FeedItemRepository.of({ ...reads(sql), ...writes(sql) });
  })
);
