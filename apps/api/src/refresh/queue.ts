import type { FeedId, OwnerId } from '@reader/business';
import { Context, Effect, Layer } from 'effect';

export interface IFeedRefreshQueue {
  readonly enqueue: (owner: OwnerId, feedId: FeedId) => Effect.Effect<void>;
}

export class FeedRefreshQueue extends Context.Service<
  FeedRefreshQueue,
  IFeedRefreshQueue
>()('api/FeedRefreshQueue') {}

type FeedRefreshQueueOptions<E, R> = {
  readonly refresh: (
    owner: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<void, E, R>;
};

const jobKey = (owner: OwnerId, feedId: FeedId) =>
  JSON.stringify([owner, feedId]);

export const feedRefreshQueueLayer = <E, R>(
  options: FeedRefreshQueueOptions<E, R>
): Layer.Layer<FeedRefreshQueue, never, R> =>
  Layer.effect(
    FeedRefreshQueue,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const services = yield* Effect.context<R>();
      const pending = new Set<string>();

      const refresh = (owner: OwnerId, feedId: FeedId) =>
        options.refresh(owner, feedId).pipe(
          Effect.catch((error) =>
            Effect.logError('Feed refresh failed', {
              owner,
              feedId,
              error,
            })
          ),
          Effect.catchDefect((defect) =>
            Effect.logError('Feed refresh crashed', {
              owner,
              feedId,
              defect,
            })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              pending.delete(jobKey(owner, feedId));
            })
          )
        );

      const enqueue = (owner: OwnerId, feedId: FeedId) =>
        Effect.gen(function* () {
          const key = jobKey(owner, feedId);
          const accepted = yield* Effect.sync(() => {
            if (pending.has(key)) {
              return false;
            }

            pending.add(key);

            return true;
          });

          if (accepted) {
            yield* Effect.forkIn(
              Effect.provideContext(refresh(owner, feedId), services),
              scope
            );
          }
        });

      return FeedRefreshQueue.of({ enqueue });
    })
  );
