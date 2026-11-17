import { listRefreshFeeds } from '@reader/sqlite';
import { type Duration, Effect, Layer } from 'effect';
import type { SqlClient } from 'effect/sql';
import { FeedRefreshQueue } from './queue.ts';

export const FEED_REFRESH_INTERVAL: Duration.Input = '30 minutes';

const enqueueFeeds = Effect.gen(function* () {
  const queue = yield* FeedRefreshQueue;
  const feeds = yield* listRefreshFeeds;

  yield* Effect.forEach(
    feeds,
    (feed) => queue.enqueue(feed.owner, feed.feedId),
    { discard: true }
  );
}).pipe(
  Effect.catch((cause) => Effect.logError('Feed refresh listing failed', cause))
);

export const feedRefreshSchedulerLayer = (options: {
  readonly interval: Duration.Input;
}): Layer.Layer<never, never, SqlClient.SqlClient | FeedRefreshQueue> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* enqueueFeeds;
      yield* Effect.forever(
        Effect.andThen(Effect.sleep(options.interval), enqueueFeeds)
      ).pipe(Effect.forkScoped);
    })
  );
