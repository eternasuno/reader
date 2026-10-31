import {
  type Context,
  type Duration,
  Effect,
  Layer,
  Option,
  Queue,
} from 'effect';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/model.ts';
import type { ContentProcessor } from '../../../../packages/business/src/port/content-processor.ts';
import {
  type Articles,
  Subscriptions,
} from '../../../../packages/business/src/port/reader-store.ts';
import type { Syndication } from '../../../../packages/business/src/port/syndication.ts';
import { refreshSubscription } from '../../../../packages/business/src/usecase/subscriptions.ts';

const WORKER_COUNT = 3;

const REFRESH_INTERVAL: Duration.Input = '30 minutes';

type SubscriptionJob = {
  readonly ownerId: OwnerId;
  readonly id: FeedId;
};

type Registration = Set<FeedId>;

type RefreshRequirements =
  | Subscriptions
  | Articles
  | Syndication
  | ContentProcessor;

const register = (registered: Registration, id: FeedId) =>
  Effect.sync(() => {
    if (registered.has(id)) {
      return false;
    }

    registered.add(id);

    return true;
  });

const enqueue =
  (queue: Queue.Queue<SubscriptionJob>, registered: Registration) =>
  (job: SubscriptionJob) =>
    register(registered, job.id).pipe(
      Effect.flatMap((accepted) =>
        accepted ? Queue.offer(queue, job) : Effect.succeed(true)
      ),
      Effect.tap((offered) =>
        offered
          ? Effect.void
          : Effect.sync(() => {
              registered.delete(job.id);
            })
      ),
      Effect.asVoid
    );

const release = (registered: Registration, id: FeedId) =>
  Effect.sync(() => {
    registered.delete(id);
  });

const refresh =
  (
    subscriptions: Context.Service.Shape<typeof Subscriptions>,
    registered: Registration
  ) =>
  (job: SubscriptionJob) =>
    Effect.gen(function* () {
      const subscription = yield* subscriptions.find(job.ownerId, job.id);
      if (Option.isNone(subscription)) {
        return;
      }

      yield* refreshSubscription(job.ownerId, job.id);
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Subscription refresh failed', error)
      ),
      Effect.ensuring(release(registered, job.id))
    );

const worker = <R>(
  queue: Queue.Queue<SubscriptionJob>,
  process: (job: SubscriptionJob) => Effect.Effect<void, never, R>
) =>
  Queue.take(queue).pipe(
    Effect.flatMap(process),
    Effect.forever,
    Effect.forkScoped
  );

const scan = (
  subscriptions: Context.Service.Shape<typeof Subscriptions>,
  enqueueJob: (job: SubscriptionJob) => Effect.Effect<void>
) =>
  subscriptions.all.pipe(
    Effect.flatMap((items) =>
      Effect.forEach(
        items,
        (item) => enqueueJob({ ownerId: item.ownerId, id: item.id }),
        { discard: true }
      )
    ),
    Effect.catch((error) =>
      Effect.logWarning('Subscription scan failed', error)
    )
  );

export const SubscriptionSchedulerLive: Layer.Layer<
  never,
  never,
  RefreshRequirements
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const subscriptions = yield* Subscriptions;
    const queue = yield* Queue.unbounded<SubscriptionJob>();
    const registered = new Set<FeedId>();

    yield* Effect.addFinalizer(() => Queue.shutdown(queue).pipe(Effect.asVoid));

    const enqueueJob = enqueue(queue, registered);
    const processJob = refresh(subscriptions, registered);

    yield* Effect.forEach(
      Array.from({ length: WORKER_COUNT }),
      () => worker(queue, processJob),
      { discard: true }
    );

    const refreshAll = scan(subscriptions, enqueueJob);

    yield* refreshAll;
    yield* Effect.forever(
      Effect.andThen(Effect.sleep(REFRESH_INTERVAL), refreshAll)
    ).pipe(Effect.forkScoped);
  })
);
