import {
  Feed,
  type FeedId,
  FeedRepository,
  FeedRepositoryError,
  type FeedTitle,
  type FolderId,
  type OwnerId,
} from '@reader/business';
import { DateTime, Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { createEach, dateFromMillis, decodeRows, inList } from './sql';

const encodeFeed = Schema.encodeSync(Feed);

const feedRepositoryError = () =>
  new FeedRepositoryError({ message: 'Failed to access feeds' });

const withUpdatedAt = (row: Readonly<Record<string, unknown>>) => {
  const { updatedAt } = row;

  return { ...row, updatedAt: dateFromMillis(updatedAt) };
};

const decodeFeeds = (rows: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
  decodeRows(rows.map(withUpdatedAt), Feed, feedRepositoryError);

const findFeed = (sql: SqlClient.SqlClient, owner: OwnerId, id: FeedId) =>
  sql`SELECT id, owner AS ownerId, url, title, folder_id AS folderId, updated_at AS updatedAt FROM feed WHERE owner = ${owner} AND id = ${id}`.pipe(
    Effect.flatMap(decodeFeeds),
    Effect.map((feeds) => Option.fromUndefinedOr(feeds[0])),
    Effect.mapError(feedRepositoryError)
  );

const listFeeds = (sql: SqlClient.SqlClient, owner: OwnerId) =>
  sql`SELECT id, owner AS ownerId, url, title, folder_id AS folderId, updated_at AS updatedAt FROM feed WHERE owner = ${owner} ORDER BY title ASC, id ASC`.pipe(
    Effect.flatMap(decodeFeeds),
    Effect.mapError(feedRepositoryError)
  );

const insertFeed = (sql: SqlClient.SqlClient) => (feed: Feed) => {
  const row = encodeFeed(feed);
  const folderId = row.folderId ?? null;
  const updatedAt =
    row.updatedAt === undefined
      ? null
      : DateTime.toEpochMillis(DateTime.fromDateUnsafe(row.updatedAt));

  return sql`INSERT INTO feed (id, owner, url, title, folder_id, updated_at) SELECT ${row.id}, ${row.ownerId}, ${row.url}, ${row.title}, ${folderId}, ${updatedAt} WHERE ${folderId} IS NULL OR EXISTS (SELECT 1 FROM folder WHERE owner = ${row.ownerId} AND id = ${folderId}) ON CONFLICT DO NOTHING RETURNING id`;
};

const createFeeds = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  feeds: ReadonlyArray<Feed>
) =>
  createEach(sql, owner, feeds, insertFeed(sql)).pipe(
    Effect.mapError(feedRepositoryError)
  );

const moveFeedToFolder = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  id: FeedId,
  folderId: Option.Option<FolderId>
) => {
  const target = Option.getOrNull(folderId);

  return sql`UPDATE feed SET folder_id = ${target} WHERE owner = ${owner} AND id = ${id} AND (${target} IS NULL OR EXISTS (SELECT 1 FROM folder WHERE owner = ${owner} AND id = ${target})) RETURNING id`.pipe(
    Effect.map((rows) => rows.length > 0),
    Effect.mapError(feedRepositoryError)
  );
};

const recordFeedSync = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  id: FeedId,
  title: FeedTitle,
  at: DateTime.Utc
) =>
  sql`UPDATE feed SET title = ${title}, updated_at = ${DateTime.toEpochMillis(at)} WHERE owner = ${owner} AND id = ${id}`.pipe(
    Effect.asVoid,
    Effect.mapError(feedRepositoryError)
  );

const removeFeeds = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  ids: ReadonlyArray<FeedId>
) =>
  ids.length === 0
    ? Effect.void
    : sql`DELETE FROM feed WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
        Effect.asVoid,
        Effect.mapError(feedRepositoryError)
      );

export const makeFeedRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return FeedRepository.of({
    find: (owner, id) => findFeed(sql, owner, id),
    list: (owner) => listFeeds(sql, owner),
    create: (owner, feeds) => createFeeds(sql, owner, feeds),
    moveToFolder: (owner, id, folderId) =>
      moveFeedToFolder(sql, owner, id, folderId),
    recordSync: (owner, id, title, at) =>
      recordFeedSync(sql, owner, id, title, at),
    remove: (owner, ids) => removeFeeds(sql, owner, ids),
  });
});
