import {
  type DocumentSanitizer,
  type FeedFetcher,
  type FeedId,
  type FeedItemRepository,
  type FeedParser,
  FeedRepository,
  type HtmlParser,
  type OwnerId,
  refreshFeed,
  type SettingsRepository,
} from '@reader/business';
import {
  type Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
} from 'effect';
import {
  type SubscriptionSchedule,
  SubscriptionSchedules,
} from './subscription-schedules.ts';

const WORKER_COUNT = 3;

/**
 * How often discovered owner schedules are reconciled. New owners refresh
 * immediately; removed owners stop within one reconciliation.
 */
const RECONCILE_INTERVAL: Duration.Input = '1 minute';

type OwnerJob = {
  readonly ownerId: OwnerId;
};

type OwnerTimers = Map<
  OwnerId,
  { readonly fiber: Fiber.Fiber<void>; readonly interval: number }
>;

type RefreshRequirements =
  | FeedRepository
  | FeedItemRepository
  | SettingsRepository
  | FeedFetcher
  | FeedParser
  | DocumentSanitizer
  | HtmlParser;

const register = (registered: Set<OwnerId>, ownerId: OwnerId) =>
  Effect.sync(() => {
    if (registered.has(ownerId)) {
      return false;
    }

    registered.add(ownerId);

    return true;
  });

const enqueue =
  (queue: Queue.Queue<OwnerJob>, registered: Set<OwnerId>) => (job: OwnerJob) =>
    register(registered, job.ownerId).pipe(
      Effect.flatMap((accepted) =>
        accepted ? Queue.offer(queue, job) : Effect.succeed(true)
      ),
      Effect.tap((offered) =>
        offered
          ? Effect.void
          : Effect.sync(() => {
              registered.delete(job.ownerId);
            })
      ),
      Effect.asVoid
    );

const release = (registered: Set<OwnerId>, ownerId: OwnerId) =>
  Effect.sync(() => {
    registered.delete(ownerId);
  });

const refreshOwnerFeed = (ownerId: OwnerId, id: FeedId) =>
  refreshFeed(ownerId, id).pipe(
    Effect.catchTag('FeedNotFound', () => Effect.void),
    Effect.catch((error) =>
      Effect.logWarning('Subscription refresh failed', error)
    )
  );

const refreshOwner =
  (
    subscriptions: Context.Service.Shape<typeof FeedRepository>,
    registered: Set<OwnerId>
  ) =>
  (job: OwnerJob) =>
    Effect.gen(function* () {
      const items = yield* subscriptions.list(job.ownerId);
      yield* Effect.forEach(
        items,
        (item) => refreshOwnerFeed(job.ownerId, item.id),
        { discard: true }
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Owner subscription refresh failed', error)
      ),
      Effect.ensuring(release(registered, job.ownerId))
    );

const worker = <R>(
  queue: Queue.Queue<OwnerJob>,
  process: (job: OwnerJob) => Effect.Effect<void, never, R>
) =>
  Queue.take(queue).pipe(
    Effect.flatMap(process),
    Effect.forever,
    Effect.forkScoped
  );

const scheduleOwner =
  (enqueueOwner: (job: OwnerJob) => Effect.Effect<void>) =>
  (schedule: SubscriptionSchedule) =>
    Effect.gen(function* () {
      yield* enqueueOwner({ ownerId: schedule.ownerId });

      return yield* Effect.forever(
        Effect.andThen(
          Effect.sleep(schedule.interval),
          enqueueOwner({ ownerId: schedule.ownerId })
        )
      );
    }).pipe(Effect.forkScoped);

const intervalMillis = (interval: Duration.Input) =>
  Option.map(Duration.fromInput(interval), Duration.toMillis);

const startOwner =
  (timers: OwnerTimers, enqueueOwner: (job: OwnerJob) => Effect.Effect<void>) =>
  (schedule: SubscriptionSchedule) =>
    Effect.gen(function* () {
      const interval = intervalMillis(schedule.interval);
      if (Option.isNone(interval)) {
        return yield* Effect.logWarning(
          'Ignoring subscription schedule with an invalid interval',
          schedule
        );
      }

      const current = timers.get(schedule.ownerId);
      if (current !== undefined && current.interval === interval.value) {
        return;
      }

      if (current !== undefined) {
        yield* Fiber.interrupt(current.fiber);
      }

      const fiber = yield* scheduleOwner(enqueueOwner)(schedule);
      timers.set(schedule.ownerId, { fiber, interval: interval.value });
    });

const stopOwner = (timers: OwnerTimers) => (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const timer = timers.get(ownerId);
    if (timer === undefined) {
      return;
    }

    timers.delete(ownerId);
    yield* Fiber.interrupt(timer.fiber);
  });

const reconcile = (
  schedules: Context.Service.Shape<typeof SubscriptionSchedules>,
  timers: OwnerTimers,
  enqueueOwner: (job: OwnerJob) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    const found = yield* schedules.list();
    const discovered = new Set<OwnerId>();

    yield* Effect.forEach(
      found,
      (schedule) =>
        Effect.sync(() => {
          discovered.add(schedule.ownerId);
        }),
      { discard: true }
    );
    yield* Effect.forEach(found, startOwner(timers, enqueueOwner), {
      discard: true,
    });

    const removed = [...timers.keys()].filter(
      (ownerId) => !discovered.has(ownerId)
    );
    yield* Effect.forEach(removed, stopOwner(timers), { discard: true });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning('Subscription schedule reconciliation failed', error)
    )
  );

export const SubscriptionSchedulerLive: Layer.Layer<
  never,
  never,
  RefreshRequirements | SubscriptionSchedules
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const subscriptions = yield* FeedRepository;
    const schedules = yield* SubscriptionSchedules;
    const queue = yield* Queue.unbounded<OwnerJob>();
    const registered = new Set<OwnerId>();
    const timers: OwnerTimers = new Map();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          [...timers.values()],
          (timer) => Fiber.interrupt(timer.fiber),
          { discard: true }
        );
        timers.clear();
        registered.clear();
        yield* Queue.shutdown(queue);
      })
    );

    const enqueueOwner = enqueue(queue, registered);
    const processOwner = refreshOwner(subscriptions, registered);

    yield* Effect.forEach(
      Array.from({ length: WORKER_COUNT }),
      () => worker(queue, processOwner),
      { discard: true }
    );

    const reconcileOwners = reconcile(schedules, timers, enqueueOwner);

    yield* reconcileOwners;
    yield* Effect.forever(
      Effect.andThen(Effect.sleep(RECONCILE_INTERVAL), reconcileOwners)
    ).pipe(Effect.forkScoped);
  })
);
