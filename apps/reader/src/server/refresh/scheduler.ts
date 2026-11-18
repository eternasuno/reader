import { listAllFeeds } from '@reader/sqlite';
import { Effect, Layer } from 'effect';
import type { SqlClient } from 'effect/sql';
import { FeedRefreshQueue } from './queue';

/** How stale a feed may get (reader-spec FD-SCHED-6). */
export const REFRESH_INTERVAL = '30 minutes' as const;

/**
 * Enqueues every stored feed of every owner (FD-SCHED-1). A failed listing is
 * logged and retried at the next tick, never at once.
 */
const enqueueEveryFeed = Effect.gen(function* () {
  const queue = yield* FeedRefreshQueue;
  const feeds = yield* listAllFeeds();

  yield* Effect.forEach(
    feeds,
    (feed) => queue.enqueue(feed.owner, feed.feedId),
    { discard: true }
  );
}).pipe(
  Effect.catch((error) =>
    Effect.logError('Feed listing failed; retrying at the next tick', error)
  )
);

/**
 * The scheduler: every feed is enqueued once at start and every
 * `REFRESH_INTERVAL` afterwards (FD-SCHED-1, FD-SCHED-6). Both stop with the
 * server scope.
 */
export const RefreshSchedulerLive: Layer.Layer<
  never,
  never,
  SqlClient.SqlClient | FeedRefreshQueue
> = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* enqueueEveryFeed;

    yield* Effect.forever(
      Effect.andThen(Effect.sleep(REFRESH_INTERVAL), enqueueEveryFeed)
    ).pipe(Effect.forkScoped);
  })
);
