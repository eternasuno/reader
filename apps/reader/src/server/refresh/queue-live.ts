import type { FeedId, OwnerId } from '@reader/business';
import { Effect, Layer } from 'effect';
import { FeedRefreshQueue } from './queue';

/** One feed's refresh; the owner is part of the key because ids are per owner. */
const jobKey = (owner: OwnerId, feedId: FeedId): string =>
  `${owner}\u0000${feedId}`;

/**
 * The refresh queue (reader-spec feeds-refresh.md, FD-SCHED-2 to FD-SCHED-4):
 * a request for a feed whose refresh is running is dropped, an accepted one
 * forks the refresh in the layer's scope, so refreshes of different feeds run
 * at the same time without a bound, and a failure or defect is logged with its
 * owner and feed id and never stops the others.
 *
 * The refresh itself is the parameter, the way `readerClientLayer` takes its
 * file: `main` passes `refreshFeed`, a test passes a stub.
 */
export const FeedRefreshQueueLive = <E, R>(
  refresh: (owner: OwnerId, feedId: FeedId) => Effect.Effect<void, E, R>
): Layer.Layer<FeedRefreshQueue, never, R> =>
  Layer.effect(
    FeedRefreshQueue,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const context = yield* Effect.context<R>();
      const running = new Set<string>();

      const run = (owner: OwnerId, feedId: FeedId) =>
        refresh(owner, feedId).pipe(
          Effect.catch((error) =>
            Effect.logError('Feed refresh failed', { owner, feedId, error })
          ),
          Effect.catchDefect((defect) =>
            Effect.logError('Feed refresh crashed', { owner, feedId, defect })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              running.delete(jobKey(owner, feedId));
            })
          )
        );

      const enqueue = Effect.fnUntraced(function* (
        owner: OwnerId,
        feedId: FeedId
      ) {
        const key = jobKey(owner, feedId);

        if (running.has(key)) {
          return;
        }

        running.add(key);
        yield* Effect.forkIn(
          Effect.provideContext(run(owner, feedId), context),
          scope
        );
      });

      return FeedRefreshQueue.of({ enqueue });
    })
  );
