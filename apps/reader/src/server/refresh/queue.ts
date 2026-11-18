import type { FeedId, OwnerId } from '@reader/business';
import { Context, type Effect } from 'effect';

/**
 * The only way a refresh runs (reader-spec feeds-refresh.md). `enqueue` returns
 * at once: it drops the request when that feed's refresh is already running,
 * otherwise forks the refresh in the queue's scope. Refreshes of different
 * feeds run concurrently without a bound; a failure is logged and never stops
 * the others.
 */
export class FeedRefreshQueue extends Context.Service<
  FeedRefreshQueue,
  {
    readonly enqueue: (owner: OwnerId, feedId: FeedId) => Effect.Effect<void>;
  }
>()('FeedRefreshQueue') {}
