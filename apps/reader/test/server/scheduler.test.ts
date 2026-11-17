import { describe, expect, it } from '@effect/vitest';
import { type FeedId, OwnerId } from '@reader/business';
import { readerStoreDatabaseLayer } from '@reader/sqlite/testing';
import { Context, Effect, Layer, Queue } from 'effect';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { FeedRefreshQueueLive } from '../../src/server/refresh/queue-live';
import {
  REFRESH_INTERVAL,
  RefreshSchedulerLive,
} from '../../src/server/refresh/scheduler';

const owner = OwnerId.make('owner-1');
const feed = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' as FeedId;

const settle = Effect.forEach(
  Array.from({ length: 10 }),
  () => Effect.yieldNow,
  { discard: true }
);

const storeOneFeed = Effect.gen(function* () {
  const context = yield* Layer.build(readerStoreDatabaseLayer);
  const sql = Context.get(context, SqlClient.SqlClient);

  yield* sql`INSERT INTO feed (id, owner, url, title)
    VALUES (${feed}, ${owner}, 'https://example.com/feed.xml', 'A feed')`;

  return context;
});

describe('the refresh scheduler', () => {
  it.effect('FD-SCHED-1 enqueues every feed at start', () =>
    Effect.gen(function* () {
      const store = yield* storeOneFeed;
      const enqueued = yield* Queue.unbounded<string>();
      const queue = FeedRefreshQueueLive((feedOwner: OwnerId, feedId: FeedId) =>
        Queue.offer(enqueued, `${feedOwner}/${feedId}`)
      );

      yield* Layer.launch(RefreshSchedulerLive).pipe(
        Effect.provide(Layer.merge(Layer.succeedContext(store), queue)),
        Effect.forkScoped
      );

      expect(yield* Queue.take(enqueued)).toBe(`${owner}/${feed}`);
    })
  );

  it.effect('FD-SCHED-6 enqueues them again at the refresh interval', () =>
    Effect.gen(function* () {
      const store = yield* storeOneFeed;
      const enqueued = yield* Queue.unbounded<string>();
      const queue = FeedRefreshQueueLive((feedOwner: OwnerId, feedId: FeedId) =>
        Queue.offer(enqueued, `${feedOwner}/${feedId}`)
      );

      yield* Layer.launch(RefreshSchedulerLive).pipe(
        Effect.provide(Layer.merge(Layer.succeedContext(store), queue)),
        Effect.forkScoped
      );

      expect(yield* Queue.take(enqueued)).toBe(`${owner}/${feed}`);

      yield* settle;
      yield* TestClock.adjust(REFRESH_INTERVAL);

      expect(yield* Queue.take(enqueued)).toBe(`${owner}/${feed}`);
    })
  );
});
