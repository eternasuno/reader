import type { FeedId, OwnerId } from '@reader/business';
import { Context, Effect, Layer, Queue } from 'effect';

export interface IFeedRefreshQueue {
  readonly enqueue: (owner: OwnerId, feedId: FeedId) => Effect.Effect<void>;
}

export class FeedRefreshQueue extends Context.Service<
  FeedRefreshQueue,
  IFeedRefreshQueue
>()('api/FeedRefreshQueue') {}

export const FEED_REFRESH_PARALLEL_JOBS = 3;

type RefreshJob = {
  readonly owner: OwnerId;
  readonly feedId: FeedId;
};

type FeedRefreshQueueOptions<E, R> = {
  readonly parallelJobs: number;
  readonly refresh: (
    owner: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<void, E, R>;
};

const jobKey = (job: RefreshJob) => JSON.stringify([job.owner, job.feedId]);

const runJob =
  <E, R>(options: FeedRefreshQueueOptions<E, R>, pending: Set<string>) =>
  (job: RefreshJob) =>
    options.refresh(job.owner, job.feedId).pipe(
      Effect.catch((error) =>
        Effect.logError('Feed refresh failed', {
          owner: job.owner,
          feedId: job.feedId,
          error,
        })
      ),
      Effect.catchDefect((defect) =>
        Effect.logError('Feed refresh crashed', {
          owner: job.owner,
          feedId: job.feedId,
          defect,
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          pending.delete(jobKey(job));
        })
      )
    );

const startWorker = <E, R>(
  options: FeedRefreshQueueOptions<E, R>,
  pending: Set<string>,
  jobs: Queue.Queue<RefreshJob>
) =>
  Effect.forever(
    Effect.flatMap(Queue.take(jobs), runJob(options, pending))
  ).pipe(Effect.forkScoped);

const enqueue =
  (jobs: Queue.Queue<RefreshJob>, pending: Set<string>) =>
  (owner: OwnerId, feedId: FeedId) =>
    Effect.gen(function* () {
      const job = { owner, feedId };
      const key = jobKey(job);
      const accepted = yield* Effect.sync(() => {
        if (pending.has(key)) {
          return false;
        }

        pending.add(key);

        return true;
      });

      if (!accepted) {
        return;
      }

      const offered = yield* Queue.offer(jobs, job);

      if (!offered) {
        yield* Effect.sync(() => {
          pending.delete(key);
        });
      }
    });

export const feedRefreshQueueLayer = <E, R>(
  options: FeedRefreshQueueOptions<E, R>
): Layer.Layer<FeedRefreshQueue, never, R> =>
  Layer.effect(
    FeedRefreshQueue,
    Effect.gen(function* () {
      const jobs = yield* Queue.unbounded<RefreshJob>();
      const pending = new Set<string>();

      yield* Effect.forEach(
        Array.from({ length: options.parallelJobs }),
        () => startWorker(options, pending, jobs),
        { discard: true }
      );

      return FeedRefreshQueue.of({ enqueue: enqueue(jobs, pending) });
    })
  );
