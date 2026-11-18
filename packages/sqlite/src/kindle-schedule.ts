import { OwnerId, SendTime } from '@reader/business';
import { Data, DateTime, Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { decodeRows, failWith } from './sql';

/** One owner whose next scheduled send is due, with the time to push it to (KD-SCHED-1). */
const DueRow = Schema.Struct({ owner: OwnerId, sendTime: SendTime });

const decodeDue = decodeRows(DueRow);

/** The cross-owner schedule failed; the scheduler logs it and retries next tick. */
export class KindleListingError extends Data.TaggedError('KindleListingError')<{
  readonly message: string;
}> {}

const failRead = failWith(
  () =>
    new KindleListingError({ message: 'Failed to read the Kindle schedule' })
);

const failWrite = failWith(
  () =>
    new KindleListingError({ message: 'Failed to write the Kindle schedule' })
);

/**
 * The rows whose next send is due at `now` and whose delivery has a send time,
 * the listing the scheduler reads (KD-SCHED-1, KD-SCHED-2). The order is by
 * due instant so the range index serves it; the scheduler does not depend on
 * it.
 */
export const listKindleDueStatement = (
  sql: SqlClient.SqlClient,
  now: DateTime.Utc
) =>
  sql`SELECT owner, send_time AS sendTime FROM setting WHERE next_send_at <= ${DateTime.toEpochMillis(now)} AND kindle_email IS NOT NULL AND send_time IS NOT NULL ORDER BY next_send_at, owner`;

/** Every owner due at `now`, whatever owner they belong to (KD-SCHED-2). */
export const listKindleDue = Effect.fn('listKindleDue')(function* (
  now: DateTime.Utc
) {
  const sql = yield* SqlClient.SqlClient;

  return yield* listKindleDueStatement(sql, now).pipe(
    Effect.flatMap(decodeDue),
    failRead
  );
});

/**
 * Moves one owner's next send to `at`, after its send was started, so one
 * check sends once per overdue owner (KD-SCHED-2).
 */
export const rescheduleKindle = Effect.fn('rescheduleKindle')(function* (
  owner: OwnerId,
  at: DateTime.Utc
) {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`UPDATE setting SET next_send_at = ${DateTime.toEpochMillis(at)} WHERE owner = ${owner}`.pipe(
    Effect.asVoid,
    failWrite
  );
});
