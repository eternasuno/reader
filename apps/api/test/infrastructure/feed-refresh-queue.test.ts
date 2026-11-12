import { expect, it } from '@effect/vitest';
import { FeedId, OwnerId } from '@reader/business';
import { Deferred, Effect, Logger } from 'effect';
import {
  FEED_REFRESH_PARALLEL_JOBS,
  FeedRefreshQueue,
  feedRefreshQueueLayer,
} from '../../src/infrastructure/feed-refresh-queue';

type FeedSignals = {
  readonly started: Deferred.Deferred<void>;
  readonly gate: Deferred.Deferred<void>;
};

type Tracker = {
  readonly started: Array<FeedId>;
  readonly enter: () => void;
  readonly leave: () => void;
  readonly peak: () => number;
};

const feedId = (suffix: string) =>
  FeedId.make(`0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5${suffix}`);

const feedA = feedId('a');
const feedB = feedId('b');
const feedC = feedId('c');

const alice = OwnerId.make('alice');

const settle = Effect.forEach(
  Array.from({ length: 10 }),
  () => Effect.yieldNow,
  {
    discard: true,
  }
);

const feedSignals = () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();

    return { started, gate };
  });

const waitForGate = (signal: FeedSignals | undefined) =>
  Effect.gen(function* () {
    if (signal === undefined) {
      return;
    }

    yield* Deferred.succeed(signal.started, undefined);
    yield* Deferred.await(signal.gate);
  });

const gatedRefresh =
  (gates: ReadonlyMap<FeedId, FeedSignals>, runs: Array<FeedId>) =>
  (_owner: OwnerId, feedId: FeedId) =>
    Effect.suspend(() => {
      runs.push(feedId);

      return waitForGate(gates.get(feedId));
    });

const trackConcurrency = (): Tracker => {
  const started: Array<FeedId> = [];
  let active = 0;
  let highest = 0;

  return {
    started,
    peak: () => highest,
    enter: () => {
      active += 1;
      highest = Math.max(highest, active);
    },
    leave: () => {
      active -= 1;
    },
  };
};

const trackedRefresh =
  (gates: ReadonlyMap<FeedId, FeedSignals>, tracker: Tracker) =>
  (_owner: OwnerId, feedId: FeedId) =>
    Effect.suspend(() => {
      tracker.started.push(feedId);
      tracker.enter();

      return waitForGate(gates.get(feedId)).pipe(
        Effect.ensuring(Effect.sync(() => tracker.leave()))
      );
    });

const collector = (logs: Array<unknown>) =>
  Logger.make((options) => {
    logs.push(options.message);
  });

const logged = (logs: ReadonlyArray<unknown>) =>
  logs.map((entry) => JSON.stringify(entry)).join('\n');

it('defaults to three parallel refreshes', () => {
  expect(FEED_REFRESH_PARALLEL_JOBS).toBe(3);
});

it.effect('drops a request for a feed that is already queued', () =>
  Effect.gen(function* () {
    const first = yield* feedSignals();
    const second = yield* feedSignals();
    const runs: Array<FeedId> = [];
    const layer = feedRefreshQueueLayer({
      parallelJobs: 1,
      refresh: gatedRefresh(
        new Map([
          [feedA, first],
          [feedB, second],
        ]),
        runs
      ),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* Deferred.await(first.started);
      yield* queue.enqueue(alice, feedB);
      yield* queue.enqueue(alice, feedB);
      yield* Deferred.succeed(first.gate, undefined);
      yield* Deferred.await(second.started);
      yield* Deferred.succeed(second.gate, undefined);
      yield* settle;

      expect(runs).toEqual([feedA, feedB]);
    }).pipe(Effect.provide(layer));
  })
);

it.effect('drops a request for a feed whose refresh is running', () =>
  Effect.gen(function* () {
    const signal = yield* feedSignals();
    const runs: Array<FeedId> = [];
    let completed = 0;
    const layer = feedRefreshQueueLayer({
      parallelJobs: 1,
      refresh: () =>
        Effect.gen(function* () {
          runs.push(feedA);
          yield* Deferred.succeed(signal.started, undefined);
          yield* Deferred.await(signal.gate);
          completed += 1;
        }),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* Deferred.await(signal.started);
      yield* queue.enqueue(alice, feedA);
      yield* queue.enqueue(alice, feedA);
      yield* Deferred.succeed(signal.gate, undefined);
      yield* settle;

      expect(runs).toEqual([feedA]);
      expect(completed).toBe(1);
    }).pipe(Effect.provide(layer));
  })
);

it.effect('refreshes a feed again after its refresh ended', () =>
  Effect.gen(function* () {
    const first = yield* feedSignals();
    const second = yield* feedSignals();
    const runs: Array<FeedId> = [];
    const layer = feedRefreshQueueLayer({
      parallelJobs: 1,
      refresh: () =>
        Effect.gen(function* () {
          const signal = runs.length === 0 ? first : second;
          runs.push(feedA);
          yield* Deferred.succeed(signal.started, undefined);
          yield* Deferred.await(signal.gate);
        }),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* Deferred.await(first.started);
      yield* Deferred.succeed(first.gate, undefined);
      yield* settle;
      yield* queue.enqueue(alice, feedA);
      yield* Deferred.await(second.started);
      yield* settle;

      expect(runs).toEqual([feedA, feedA]);
    }).pipe(Effect.provide(layer));
  })
);

it.effect('runs at most the configured number of refreshes at once', () =>
  Effect.gen(function* () {
    const first = yield* feedSignals();
    const second = yield* feedSignals();
    const third = yield* feedSignals();
    const tracker = trackConcurrency();
    const gates = new Map([
      [feedA, first],
      [feedB, second],
      [feedC, third],
    ]);
    const layer = feedRefreshQueueLayer({
      parallelJobs: 2,
      refresh: trackedRefresh(gates, tracker),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* queue.enqueue(alice, feedB);
      yield* queue.enqueue(alice, feedC);
      yield* settle;

      expect(tracker.started).toHaveLength(2);
      expect(tracker.peak()).toBe(2);

      yield* Deferred.succeed(first.gate, undefined);
      yield* Deferred.await(third.started);

      expect(tracker.started).toHaveLength(3);
      expect(tracker.peak()).toBe(2);
    }).pipe(Effect.provide(layer));
  })
);

it.effect('runs refreshes of two feeds of one owner at the same time', () =>
  Effect.gen(function* () {
    const first = yield* feedSignals();
    const second = yield* feedSignals();
    const tracker = trackConcurrency();
    const gates = new Map([
      [feedA, first],
      [feedB, second],
    ]);
    const layer = feedRefreshQueueLayer({
      parallelJobs: 2,
      refresh: trackedRefresh(gates, tracker),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* queue.enqueue(alice, feedB);
      yield* Deferred.await(first.started);
      yield* Deferred.await(second.started);
      yield* Deferred.succeed(first.gate, undefined);
      yield* Deferred.succeed(second.gate, undefined);
      yield* settle;

      expect(tracker.peak()).toBe(2);
      expect([...tracker.started].sort()).toEqual([feedA, feedB].sort());
    }).pipe(Effect.provide(layer));
  })
);

it.effect('logs a failed refresh and keeps refreshing other feeds', () => {
  const logs: Array<unknown> = [];

  return Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const runs: Array<FeedId> = [];
    const layer = feedRefreshQueueLayer({
      parallelJobs: 1,
      refresh: (_owner, feedId) =>
        Effect.suspend(() => {
          runs.push(feedId);

          return feedId === feedA
            ? Effect.fail({ message: 'source unavailable' })
            : Deferred.succeed(done, undefined).pipe(Effect.asVoid);
        }),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* queue.enqueue(alice, feedB);
      yield* Deferred.await(done);
      yield* settle;

      expect(runs).toEqual([feedA, feedB]);
      expect(logged(logs)).toContain(alice);
      expect(logged(logs)).toContain(feedA);
      expect(logged(logs)).toContain('source unavailable');
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Logger.layer([collector(logs)])));
});

it.effect('keeps working after a refresh defect', () => {
  const logs: Array<unknown> = [];

  return Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const runs: Array<FeedId> = [];
    const layer = feedRefreshQueueLayer({
      parallelJobs: 1,
      refresh: (_owner, feedId) =>
        Effect.suspend(() => {
          runs.push(feedId);

          return feedId === feedA
            ? Effect.die(new Error('unexpected'))
            : Deferred.succeed(done, undefined).pipe(Effect.asVoid);
        }),
    });

    yield* Effect.gen(function* () {
      const queue = yield* FeedRefreshQueue;
      yield* queue.enqueue(alice, feedA);
      yield* queue.enqueue(alice, feedB);
      yield* Deferred.await(done);
      yield* settle;

      expect(runs).toEqual([feedA, feedB]);
      expect(logged(logs)).toContain(feedA);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Logger.layer([collector(logs)])));
});
