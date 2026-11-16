import { expect, it } from '@effect/vitest';
import { FeedId, type OwnerId } from '@reader/business';
import { Context, Deferred, Effect, Layer, Logger } from 'effect';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { FeedRefreshQueue } from '../../src/refresh/queue';
import {
  FEED_REFRESH_INTERVAL,
  feedRefreshSchedulerLayer,
} from '../../src/refresh/scheduler';
import { readerDatabaseLayer } from '../support/store';

type Enqueued = {
  readonly owner: OwnerId;
  readonly feedId: FeedId;
};

type Sql = SqlClient.SqlClient;

const feedId = (suffix: string) =>
  FeedId.make(`0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5${suffix}`);

const feedA = feedId('a');
const feedB = feedId('b');

const insertFeed = (sql: Sql, owner: string, id: string) =>
  sql`INSERT INTO feed (id, owner, url, title) VALUES (${id}, ${owner}, ${`https://example.com/${id}`}, ${'Example feed'})`.pipe(
    Effect.asVoid
  );

const removeFeeds = (sql: Sql) => sql`DELETE FROM feed`.pipe(Effect.asVoid);

const useDatabase = <A, E>(
  seed: (sql: Sql) => Effect.Effect<void, E>,
  run: (sql: Sql) => Effect.Effect<A, E>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(readerDatabaseLayer);
      const sql = Context.get(context, SqlClient.SqlClient);

      yield* seed(sql);

      return yield* run(sql);
    })
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
    (sql) =>
      Effect.gen(function* () {
        yield* insertFeed(sql, 'alice', feedA);
        yield* insertFeed(sql, 'bob', feedB);
      }),
    (sql) =>
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
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(SqlClient.SqlClient, sql)
        );
      })
  )
);

it.effect('picks up feeds added after the start', () =>
  useDatabase(
    (sql) => insertFeed(sql, 'alice', feedA),
    (sql) =>
      Effect.gen(function* () {
        const recorded: Array<Enqueued> = [];
        const signals = yield* makeSignals(4);
        const layer = feedRefreshSchedulerLayer({
          interval: FEED_REFRESH_INTERVAL,
        }).pipe(Layer.provide(recordingQueue(recorded, signals)));

        yield* Effect.gen(function* () {
          yield* awaitEnqueue(signals, 0);
          expect(enqueued(recorded)).toEqual([`alice/${feedA}`]);

          yield* insertFeed(sql, 'bob', feedB);
          yield* TestClock.adjust(FEED_REFRESH_INTERVAL);
          yield* awaitEnqueue(signals, 2);

          expect(enqueued(recorded)).toEqual([
            `alice/${feedA}`,
            `alice/${feedA}`,
            `bob/${feedB}`,
          ]);
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(SqlClient.SqlClient, sql)
        );
      })
  )
);

it.effect('logs a failed listing and retries at the next interval', () => {
  const logs: Array<unknown> = [];

  return useDatabase(
    (sql) => insertFeed(sql, 'alice', 'invalid'),
    (sql) =>
      Effect.gen(function* () {
        const recorded: Array<Enqueued> = [];
        const signals = yield* makeSignals(2);
        const layer = feedRefreshSchedulerLayer({
          interval: FEED_REFRESH_INTERVAL,
        }).pipe(Layer.provide(recordingQueue(recorded, signals)));

        yield* Effect.gen(function* () {
          expect(recorded).toHaveLength(0);
          expect(logged(logs)).toContain('Feed refresh listing failed');

          yield* removeFeeds(sql);
          yield* insertFeed(sql, 'alice', feedA);
          yield* TestClock.adjust(FEED_REFRESH_INTERVAL);
          yield* awaitEnqueue(signals, 0);

          expect(enqueued(recorded)).toEqual([`alice/${feedA}`]);
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(SqlClient.SqlClient, sql)
        );
      })
  ).pipe(Effect.provide(Logger.layer([collector(logs)])));
});
