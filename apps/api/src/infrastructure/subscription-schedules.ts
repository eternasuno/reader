import { Context, Data, type Duration, Effect, Layer, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { OwnerId } from '../../../../packages/business/src/entity/object-value.ts';
import { Database } from './db/index.ts';

export const OWNER_REFRESH_INTERVAL: Duration.Input = '30 minutes';

export type SubscriptionSchedule = {
  readonly ownerId: OwnerId;
  readonly interval: Duration.Input;
};

export class SubscriptionScheduleError extends Data.TaggedError(
  'SubscriptionScheduleError'
)<{ readonly message: string }> {}

export type ISubscriptionSchedules = {
  readonly list: () => Effect.Effect<
    readonly SubscriptionSchedule[],
    SubscriptionScheduleError
  >;
};

export class SubscriptionSchedules extends Context.Service<
  SubscriptionSchedules,
  ISubscriptionSchedules
>()('reader/SubscriptionSchedules') {}

const OWNER_SQL = 'SELECT owner FROM feed GROUP BY owner;';

const OwnerRow = Schema.Struct({ owner: OwnerId });

const ownerRows = Schema.Array(OwnerRow);

const scheduleError = () =>
  new SubscriptionScheduleError({
    message: 'Failed to read subscription schedules',
  });

const discoverOwners = (db: Surreal) =>
  Effect.tryPromise({
    try: () => db.query<unknown[]>(OWNER_SQL),
    catch: scheduleError,
  }).pipe(
    Effect.flatMap(([rows]) =>
      Schema.decodeUnknownEffect(ownerRows)(rows).pipe(
        Effect.mapError(scheduleError)
      )
    )
  );

export const SubscriptionSchedulesLive: Layer.Layer<
  SubscriptionSchedules,
  never,
  Database
> = Layer.effect(
  SubscriptionSchedules,
  Effect.gen(function* () {
    const db = yield* Database;

    return SubscriptionSchedules.of({
      list: () =>
        discoverOwners(db).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              ownerId: row.owner,
              interval: OWNER_REFRESH_INTERVAL,
            }))
          )
        ),
    });
  })
);
