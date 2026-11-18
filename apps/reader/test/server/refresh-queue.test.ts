import { describe, expect, it } from '@effect/vitest';
import { type FeedId, OwnerId } from '@reader/business';
import { Data, Deferred, Effect, Queue, Ref } from 'effect';
import { FeedRefreshQueue } from '../../src/server/refresh/queue';
import { FeedRefreshQueueLive } from '../../src/server/refresh/queue-live';

const owner = OwnerId.make('owner-1');

const first = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' as FeedId;
const second = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c' as FeedId;

/** Lets the queue's forked runs finish: the test clock never advances. */
const settle = Effect.forEach(
  Array.from({ length: 20 }),
  () => Effect.yieldNow,
  { discard: true }
);

class RefreshFailed extends Data.TaggedError('RefreshFailed')<{
  readonly message: string;
}> {}

/** A refresh that signals every start and then waits for the gate. */
const gated =
  (starts: Queue.Queue<string>, gate: Deferred.Deferred<void>) =>
  (feedOwner: OwnerId, feed: FeedId) =>
    Queue.offer(starts, `${feedOwner}/${feed}`).pipe(
      Effect.andThen(Deferred.await(gate))
    );

/** A refresh that counts the attempts of each feed and signals every start. */
const counting =
  (starts: Queue.Queue<string>, attempts: Ref.Ref<Record<string, number>>) =>
  (feedOwner: OwnerId, feed: FeedId) =>
    Effect.gen(function* () {
      const seen = yield* Ref.updateAndGet(attempts, (all) => ({
        ...all,
        [feed]: (all[feed] ?? 0) + 1,
      }));

      yield* Queue.offer(starts, `${feedOwner}/${feed}#${seen[feed]}`);

      return seen[feed] ?? 0;
    });

const dropsWhileRunning = Effect.gen(function* () {
  const starts = yield* Queue.unbounded<string>();
  const gate = yield* Deferred.make<void>();

  yield* Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;

    yield* queue.enqueue(owner, first);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${first}`);

    yield* queue.enqueue(owner, first);
    yield* Effect.yieldNow;
    expect(yield* Queue.size(starts)).toBe(0);

    yield* queue.enqueue(owner, second);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${second}`);

    yield* Deferred.succeed(gate, undefined);
  }).pipe(Effect.provide(FeedRefreshQueueLive(gated(starts, gate))));
});

const runsDifferentFeedsAtOnce = Effect.gen(function* () {
  const starts = yield* Queue.unbounded<string>();
  const gate = yield* Deferred.make<void>();

  yield* Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;

    yield* queue.enqueue(owner, first);
    yield* queue.enqueue(owner, second);

    const started = [yield* Queue.take(starts), yield* Queue.take(starts)];

    expect(started.sort()).toEqual(
      [`${owner}/${first}`, `${owner}/${second}`].sort()
    );

    yield* Deferred.succeed(gate, undefined);
  }).pipe(Effect.provide(FeedRefreshQueueLive(gated(starts, gate))));
});

const failingRefreshDoesNotStopOthers = Effect.gen(function* () {
  const starts = yield* Queue.unbounded<string>();
  const attempts = yield* Ref.make<Record<string, number>>({});
  const count = counting(starts, attempts);
  const refresh = (feedOwner: OwnerId, feed: FeedId) =>
    count(feedOwner, feed).pipe(
      Effect.flatMap((attempt) =>
        feed === first && attempt === 1
          ? new RefreshFailed({ message: 'the source is unreachable' })
          : Effect.void
      )
    );

  yield* Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;

    yield* queue.enqueue(owner, first);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${first}#1`);

    // The second feed starts although the first one failed (FD-SCHED-4).
    yield* queue.enqueue(owner, second);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${second}#1`);

    // The failed run released its feed, so it can be enqueued again.
    yield* settle;
    yield* queue.enqueue(owner, first);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${first}#2`);
  }).pipe(Effect.provide(FeedRefreshQueueLive(refresh)));
});

const defectReleasesItsFeed = Effect.gen(function* () {
  const starts = yield* Queue.unbounded<string>();
  const attempts = yield* Ref.make<Record<string, number>>({});
  const count = counting(starts, attempts);
  const refresh = (feedOwner: OwnerId, feed: FeedId) =>
    count(feedOwner, feed).pipe(
      Effect.flatMap((attempt) =>
        attempt === 1
          ? Effect.die(new Error('the parser crashed'))
          : Effect.void
      )
    );

  yield* Effect.gen(function* () {
    const queue = yield* FeedRefreshQueue;

    yield* queue.enqueue(owner, first);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${first}#1`);

    yield* settle;
    yield* queue.enqueue(owner, first);
    expect(yield* Queue.take(starts)).toBe(`${owner}/${first}#2`);
  }).pipe(Effect.provide(FeedRefreshQueueLive(refresh)));
});

describe('FeedRefreshQueue: one run per feed', () => {
  it.effect(
    'FD-SCHED-2 drops a request for a feed whose refresh is running',
    () => dropsWhileRunning
  );

  it.effect(
    'FD-SCHED-3 runs different feeds at the same time',
    () => runsDifferentFeedsAtOnce
  );
});

describe('FeedRefreshQueue: a bad run does not stop the others', () => {
  it.effect(
    'FD-SCHED-4 a failed refresh does not stop the others',
    () => failingRefreshDoesNotStopOthers
  );

  it.effect(
    'FD-SCHED-4 a defective refresh releases its feed',
    () => defectReleasesItsFeed
  );
});
