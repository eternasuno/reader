import { FeedId, OwnerId } from '@reader/business';
import { Data, type Duration, Effect, Layer, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../db/index.ts';
import { FeedRefreshQueue } from './queue.ts';

export const FEED_REFRESH_INTERVAL: Duration.Input = '30 minutes';

const FEEDS_SQL = 'SELECT owner, feedId FROM feed;';

const FeedRow = Schema.Struct({ owner: OwnerId, feedId: FeedId });

const feedRows = Schema.Array(FeedRow);

class FeedListingError extends Data.TaggedError('FeedListingError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const listFeeds = (db: Surreal) =>
  Effect.tryPromise({
    try: () => db.query<Array<unknown>>(FEEDS_SQL),
    catch: (cause) =>
      new FeedListingError({ message: 'Failed to read feeds', cause }),
  }).pipe(
    Effect.flatMap((results) =>
      Schema.decodeUnknownEffect(feedRows)(results[0] ?? [])
    )
  );

const enqueueFeeds = (db: Surreal) =>
  Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;
    const feeds = yield* listFeeds(db);

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
}): Layer.Layer<never, never, Database | FeedRefreshQueue> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const db = yield* Database;

      yield* enqueueFeeds(db);
      yield* Effect.forever(
        Effect.andThen(Effect.sleep(options.interval), enqueueFeeds(db))
      ).pipe(Effect.forkScoped);
    })
  );
