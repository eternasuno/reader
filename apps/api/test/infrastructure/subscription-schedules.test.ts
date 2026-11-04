// biome-ignore-all lint/style/noExcessiveLinesPerFile: real database scenarios share one store fixture.
import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Duration, Effect, Layer, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { Feed } from '../../../../packages/business/src/entity/feed.ts';
import { OwnerId } from '../../../../packages/business/src/entity/object-value.ts';
import { FeedRepository } from '../../../../packages/business/src/port/feed-repository.ts';
import {
  ReaderStoreLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { createSurreal, Database } from '../../src/infrastructure/db';
import {
  OWNER_REFRESH_INTERVAL,
  SubscriptionSchedules,
  SubscriptionSchedulesLive,
} from '../../src/infrastructure/subscription-schedules';

type Store = FeedRepository | SubscriptionSchedules;

const owner = (value: string) => Schema.decodeSync(OwnerId)(value);

const feed = (ownerId: string, url: string) =>
  Schema.decodeSync(Feed)({
    id: createHash('sha256')
      .update(JSON.stringify([ownerId, url]))
      .digest('hex'),
    ownerId,
    url,
    title: url,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

const withStore = <A, E>(check: Effect.Effect<A, E, Store>) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `reader-schedules-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db: Surreal) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(
          check.pipe(
            Effect.provide(
              Layer.mergeAll(ReaderStoreLive, SubscriptionSchedulesLive).pipe(
                Layer.provide(Layer.succeed(Database, db))
              )
            )
          )
        )
      ),
    (db: Surreal) => Effect.promise(() => db.close())
  );

it.effect(
  'projects one schedule per feed owner with the default interval',
  () =>
    withStore(
      Effect.gen(function* () {
        const feeds = yield* FeedRepository;
        yield* feeds.create(owner('alice'), [
          feed('alice', 'https://example.com/a.xml'),
          feed('alice', 'https://example.com/b.xml'),
        ]);
        yield* feeds.create(owner('bob'), [
          feed('bob', 'https://example.com/c.xml'),
        ]);

        const schedules = yield* SubscriptionSchedules;
        const projected = yield* schedules.list();

        expect(
          [...projected.map((schedule) => schedule.ownerId)].sort()
        ).toEqual(['alice', 'bob']);
        expect(
          projected.map((schedule) => Duration.toMinutes(schedule.interval))
        ).toEqual([30, 30]);
        expect(OWNER_REFRESH_INTERVAL).toBe('30 minutes');
      })
    )
);

it.effect('drops owners once their last feed is removed', () =>
  withStore(
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const alice = feed('alice', 'https://example.com/a.xml');
      const bob = feed('bob', 'https://example.com/b.xml');
      yield* feeds.create(owner('alice'), [alice]);
      yield* feeds.create(owner('bob'), [bob]);

      const schedules = yield* SubscriptionSchedules;
      expect(yield* schedules.list()).toHaveLength(2);

      yield* feeds.remove(owner('alice'), [alice.id]);

      expect((yield* schedules.list()).map((item) => item.ownerId)).toEqual([
        'bob',
      ]);
    })
  )
);
