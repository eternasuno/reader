import { FeedId, OwnerId } from '@reader/business';
import { Data, Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';

const FeedRow = Schema.Struct({ owner: OwnerId, feedId: FeedId });

const feedRows = Schema.Array(FeedRow);

export class FeedListingError extends Data.TaggedError('FeedListingError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export const listRefreshFeeds = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql`SELECT owner, id AS feedId FROM feed`;

  return yield* Schema.decodeUnknownEffect(feedRows)(rows);
}).pipe(
  Effect.mapError(
    (cause) => new FeedListingError({ message: 'Failed to read feeds', cause })
  )
);
