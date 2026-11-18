import { FeedId, OwnerId } from '@reader/business';
import { Data, Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { decodeRows, failWith } from './sql';

/** One feed the scheduler refreshes, whatever its owner (FD-SCHED-1). */
export const ScheduledFeed = Schema.Struct({
  owner: OwnerId,
  feedId: FeedId,
});

export type ScheduledFeed = typeof ScheduledFeed.Type;

/** The cross-owner listing failed; the scheduler logs it and retries next tick. */
export class FeedListingError extends Data.TaggedError('FeedListingError')<{
  readonly message: string;
}> {}

const decodeScheduledFeeds = decodeRows(ScheduledFeed);

const fail = failWith(
  () => new FeedListingError({ message: 'Failed to read feeds' })
);

/**
 * Every feed of every owner, the listing the scheduler reads
 * (reader-engineering: Server, Refresh).
 */
export const listAllFeeds = Effect.fn('listAllFeeds')(function* () {
  const sql = yield* SqlClient.SqlClient;

  return yield* sql`SELECT owner, id AS feedId FROM feed`.pipe(
    Effect.flatMap(decodeScheduledFeeds),
    fail
  );
});
