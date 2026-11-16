import { FeedId, OwnerId } from '@reader/business';
import { Data, type Duration, Effect, Layer, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { FeedRefreshQueue } from './queue.ts';

export const FEED_REFRESH_INTERVAL: Duration.Input = '30 minutes';

const FeedRow = Schema.Struct({ owner: OwnerId, feedId: FeedId });

const feedRows = Schema.Array(FeedRow);

class FeedListingError extends Data.TaggedError('FeedListingError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const listFeeds = (sql: SqlClient.SqlClient) =>
  sql`SELECT owner, id AS feedId FROM feed`.pipe(
    Effect.flatMap((rows) => Schema.decodeUnknownEffect(feedRows)(rows)),
    Effect.mapError(
      (cause) =>
        new FeedListingError({ message: 'Failed to read feeds', cause })
    )
  );

const enqueueFeeds = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;
    const feeds = yield* listFeeds(sql);

    yield* Effect.forEach(
      feeds,
      (feed) => queue.enqueue(feed.owner, feed.feedId),
      { discard: true }
    );
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError('Feed refresh listing failed', cause)
    )
  );

export const feedRefreshSchedulerLayer = (options: {
  readonly interval: Duration.Input;
}): Layer.Layer<never, never, SqlClient.SqlClient | FeedRefreshQueue> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* enqueueFeeds(sql);
      yield* Effect.forever(
        Effect.andThen(Effect.sleep(options.interval), enqueueFeeds(sql))
      ).pipe(Effect.forkScoped);
    })
  );
