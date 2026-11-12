import { randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { FeedId, type OwnerId } from '@reader/business';
import { Deferred, Effect, Layer, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import type { Surreal } from 'surrealdb';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { FeedRefreshQueue } from '../../src/infrastructure/feed-refresh-queue';
import {
  FEED_REFRESH_INTERVAL,
  feedRefreshSchedulerLayer,
} from '../../src/infrastructure/feed-refresh-scheduler';

type Enqueued = {
  readonly owner: OwnerId;
  readonly feedId: FeedId;
};

const feedId = (suffix: string) =>
  FeedId.make(`0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5${suffix}`);

const feedA = feedId('a');
const feedB = feedId('b');

const insertFeed = (db: Surreal, owner: string, feedId: FeedId) =>
  Effect.promise(() =>
    db.query('CREATE feed SET owner = $owner, feedId = $feedId;', {
      owner,
      feedId,
    })
  );

const removeFeeds = (db: Surreal) =>
  Effect.promise(() => db.query('DELETE feed;'));

const useDatabase = <A, E>(
  seed: (db: Surreal) => Effect.Effect<unknown>,
  run: (db: Surreal) => Effect.Effect<A, E>
) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `reader-refresh-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) => seed(db).pipe(Effect.andThen(run(db))),
    (db) => Effect.promise(() => db.close())
  );

const makeSignals = (count: number) =>
  Effect.forEach(Array.from({ length: count }), () => Deferred.make<void>());

const awaitEnqueue = (
  signals: ReadonlyArray<Deferred.Deferred<void>>,
  index: number
) => {
  const signal = signals[index];

  return signal === undefined ? Effect.void : Deferred.await(signal);
};

const recordingQueue = (
  recorded: Array<Enqueued>,
  signals: ReadonlyArray<Deferred.Deferred<void>>
) =>
  Layer.succeed(
    FeedRefreshQueue,
    FeedRefreshQueue.of({
      enqueue: (owner, feedId) =>
        Effect.gen(function* () {
          recorded.push({ owner, feedId });

          const signal = signals[recorded.length - 1];

          if (signal !== undefined) {
            yield* Deferred.succeed(signal, undefined);
          }
        }),
    })
  );

const enqueued = (recorded: ReadonlyArray<Enqueued>) =>
  recorded.map((entry) => `${entry.owner}/${entry.feedId}`).sort();

const collector = (logs: Array<unknown>) =>
  Logger.make((options) => {
    logs.push(options.message);
  });

const logged = (logs: ReadonlyArray<unknown>) =>
  logs.map((entry) => JSON.stringify(entry)).join('\n');

it.effect('enqueues every feed at start and again after the interval', () =>
  useDatabase(
    (db) =>
      Effect.gen(function* () {
        yield* insertFeed(db, 'alice', feedA);
        yield* insertFeed(db, 'bob', feedB);
      }),
    (db) =>
      Effect.gen(function* () {
        const recorded: Array<Enqueued> = [];
        const signals = yield* makeSignals(4);
        const layer = feedRefreshSchedulerLayer({
          interval: FEED_REFRESH_INTERVAL,
        }).pipe(Layer.provide(recordingQueue(recorded, signals)));

        yield* Effect.gen(function* () {
          yield* awaitEnqueue(signals, 1);

          expect(enqueued(recorded)).toEqual([
            `alice/${feedA}`,
            `bob/${feedB}`,
          ]);

          yield* TestClock.adjust(FEED_REFRESH_INTERVAL);
          yield* awaitEnqueue(signals, 3);

          expect(enqueued(recorded)).toEqual([
            `alice/${feedA}`,
            `alice/${feedA}`,
            `bob/${feedB}`,
            `bob/${feedB}`,
          ]);
        }).pipe(Effect.provide(layer), Effect.provideService(Database, db));
      })
  )
);

it.effect('picks up feeds added after the start', () =>
  useDatabase(
    (db) => insertFeed(db, 'alice', feedA),
    (db) =>
      Effect.gen(function* () {
        const recorded: Array<Enqueued> = [];
        const signals = yield* makeSignals(4);
        const layer = feedRefreshSchedulerLayer({
          interval: FEED_REFRESH_INTERVAL,
        }).pipe(Layer.provide(recordingQueue(recorded, signals)));

        yield* Effect.gen(function* () {
          yield* awaitEnqueue(signals, 0);
          expect(enqueued(recorded)).toEqual([`alice/${feedA}`]);

          yield* insertFeed(db, 'bob', feedB);
          yield* TestClock.adjust(FEED_REFRESH_INTERVAL);
          yield* awaitEnqueue(signals, 2);

          expect(enqueued(recorded)).toEqual([
            `alice/${feedA}`,
            `alice/${feedA}`,
            `bob/${feedB}`,
          ]);
        }).pipe(Effect.provide(layer), Effect.provideService(Database, db));
      })
  )
);

it.effect('logs a failed listing and retries at the next interval', () => {
  const logs: Array<unknown> = [];

  return useDatabase(
    (db) =>
      Effect.promise(() =>
        db.query("CREATE feed SET owner = 'alice', feedId = 'invalid';")
      ),
    (db) =>
      Effect.gen(function* () {
        const recorded: Array<Enqueued> = [];
        const signals = yield* makeSignals(2);
        const layer = feedRefreshSchedulerLayer({
          interval: FEED_REFRESH_INTERVAL,
        }).pipe(Layer.provide(recordingQueue(recorded, signals)));

        yield* Effect.gen(function* () {
          expect(recorded).toHaveLength(0);
          expect(logged(logs)).toContain('Feed refresh listing failed');

          yield* removeFeeds(db);
          yield* insertFeed(db, 'alice', feedA);
          yield* TestClock.adjust(FEED_REFRESH_INTERVAL);
          yield* awaitEnqueue(signals, 0);

          expect(enqueued(recorded)).toEqual([`alice/${feedA}`]);
        }).pipe(Effect.provide(layer), Effect.provideService(Database, db));
      })
  ).pipe(Effect.provide(Logger.layer([collector(logs)])));
});

it('defaults to a 30 minute refresh interval', () => {
  expect(FEED_REFRESH_INTERVAL).toBe('30 minutes');
});
