import type { OwnerId } from '@reader/business';
import { listKindleDue, rescheduleKindle } from '@reader/sqlite';
import { DateTime, Effect, Layer } from 'effect';
import type { SqlClient } from 'effect/sql';
import { nextOccurrence } from './local-time';
import { type KindleSend, KindleSender } from './sender';

/** The check runs at every half-hour boundary (KD-SCHED-2). */
const HALF_HOUR = 1_800_000;

/** How long to sleep to reach the next half-hour boundary (KD-SCHED-2). */
const untilNextHalfHour = Effect.map(DateTime.now, (now) => {
  const millis = DateTime.toEpochMillis(now);

  return HALF_HOUR - (millis % HALF_HOUR);
});

const instantOf = (millis: number): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date(millis));

/**
 * One due send runs in the layer's scope and is not awaited (KD-SCHED-7): a
 * send that is already running is skipped silently, any other failure is
 * logged with the owner and the tag, never the password (KD-SCHED-3).
 */
const startSend = (send: KindleSend, owner: OwnerId) =>
  send(owner).pipe(
    Effect.catchTag('KindleSendInProgress', () => Effect.void),
    Effect.catch((error) =>
      Effect.logError('Kindle send failed', { owner, error: error._tag })
    ),
    Effect.catchDefect(() => Effect.logError('Kindle send crashed', { owner })),
    Effect.forkScoped
  );

/**
 * Every owner whose next send has come due: its next send is written for the
 * next occurrence of its time before the send starts, so a check after
 * downtime sends once per overdue owner and pushes it a day ahead
 * (KD-SCHED-1, KD-SCHED-2).
 */
const sendDue = Effect.gen(function* () {
  const sender = yield* KindleSender;
  const now = yield* DateTime.now;
  const due = yield* listKindleDue(now);

  yield* Effect.forEach(
    due,
    ({ owner, sendTime }) => {
      const next = nextOccurrence(DateTime.toEpochMillis(now), sendTime);

      return rescheduleKindle(owner, instantOf(next)).pipe(
        Effect.andThen(startSend(sender.send, owner))
      );
    },
    { discard: true }
  );
});

/** A failed check is logged and retried at the next half hour (KD-SCHED-2). */
const tick = sendDue.pipe(
  Effect.catch((error) =>
    Effect.logError('Kindle schedule failed; retrying next half hour', error)
  )
);

/**
 * The Kindle schedule (KD-SCHED): one check when the server starts and then
 * one at every half-hour boundary, in the server's own time zone, until the
 * server scope ends.
 */
export const KindleSchedulerLive: Layer.Layer<
  never,
  never,
  SqlClient.SqlClient | KindleSender
> = Layer.effectDiscard(
  Effect.andThen(
    tick,
    Effect.forever(
      Effect.andThen(
        Effect.flatMap(untilNextHalfHour, (millis) => Effect.sleep(millis)),
        tick
      )
    )
  ).pipe(Effect.forkScoped)
);
