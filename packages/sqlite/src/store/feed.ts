import { Feed, FeedRepository, FeedRepositoryError } from '@reader/business';
import { DateTime, Effect, Layer, Option } from 'effect';
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
} from './sql';

const fail = failWith(
  () => new FeedRepositoryError({ message: 'Failed to access feeds' })
);

const decodeFeeds = decodeRows(Feed, ({ updatedAt, ...row }) => ({
  ...row,
  updatedAt: dateFromMillis(updatedAt),
}));

const SELECT =
  'SELECT id, owner AS ownerId, url, title, folder_id AS folderId, updated_at AS updatedAt FROM feed';

export const FeedRepositoryLive = Layer.effect(
  FeedRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const select = sql.literal(SELECT);

    return FeedRepository.of({
      find: (owner, id) =>
        sql`${select} WHERE owner = ${owner} AND id = ${id}`.pipe(
          Effect.flatMap(decodeFeeds),
          Effect.map(first),
          fail
        ),
      list: (owner) =>
        sql`${select} WHERE owner = ${owner} ORDER BY title, id`.pipe(
          Effect.flatMap(decodeFeeds),
          fail
        ),
      create: (owner, feeds) =>
        createEach(sql, owner, feeds, (feed) => {
          const folderId = Option.getOrNull(feed.folderId);

          return sql`INSERT INTO feed (id, owner, url, title, folder_id, updated_at) SELECT ${feed.id}, ${feed.ownerId}, ${feed.url.href}, ${feed.title}, ${folderId}, ${millisOrNull(feed.updatedAt)} WHERE ${folderId} IS NULL OR EXISTS (SELECT 1 FROM folder WHERE owner = ${feed.ownerId} AND id = ${folderId}) ON CONFLICT DO NOTHING RETURNING id`;
        }).pipe(fail),
      moveToFolder: (owner, id, folderId) => {
        const target = Option.getOrNull(folderId);

        return sql`UPDATE feed SET folder_id = ${target} WHERE owner = ${owner} AND id = ${id} AND (${target} IS NULL OR EXISTS (SELECT 1 FROM folder WHERE owner = ${owner} AND id = ${target})) RETURNING id`.pipe(
          Effect.map(changed),
          fail
        );
      },
      recordSync: (owner, id, title, at) =>
        sql`UPDATE feed SET title = ${title}, updated_at = ${DateTime.toEpochMillis(at)} WHERE owner = ${owner} AND id = ${id}`.pipe(
          Effect.asVoid,
          fail
        ),
      remove: (owner, ids) =>
        sql`DELETE FROM feed WHERE owner = ${owner} AND ${inList(sql, 'id', ids)}`.pipe(
          Effect.asVoid,
          fail
        ),
    });
  })
);
