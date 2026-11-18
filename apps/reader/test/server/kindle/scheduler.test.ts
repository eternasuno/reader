import { describe, expect, it } from '@effect/vitest';
import { KindleDelivery, SendTime, SettingRepository } from '@reader/business';
import { alice, bob } from '@reader/business/testing';
import { readerStoreDatabaseLayer } from '@reader/sqlite/testing';
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { nextOccurrence } from '../../../src/server/kindle/local-time';
import { KindleSchedulerLive } from '../../../src/server/kindle/scheduler';
import {
  KindleSender,
  KindleSendInProgress,
} from '../../../src/server/kindle/sender';

/** The check runs at every half-hour boundary (KD-SCHED-2). */
const HALF_HOUR = 1_800_000;

type Store = Context.Context<Layer.Success<typeof readerStoreDatabaseLayer>>;

/** Lets the scheduler reach its sleep and its forked sends finish. */
const settle = Effect.forEach(
  Array.from({ length: 10 }),
  () => Effect.yieldNow,
  { discard: true }
);

const advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(millis), settle);

const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

const instant = (millis: number): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date(millis));

const time = (value: string): SendTime => Schema.decodeSync(SendTime)(value);

const pad = (value: number): string => String(value).padStart(2, '0');

/** The server-local `HH:MM` of an instant, the form a stored send time takes. */
const sendTimeOf = (millis: number): SendTime => {
  const date = new Date(millis);

  return time(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
};

/** The first epoch half-hour boundary strictly after an instant. */
const boundaryAfter = (millis: number): number =>
  millis + (HALF_HOUR - (millis % HALF_HOUR));

/** A delivery whose send time is the given one (SET-KINDLE-1, KD-SCHED-1). */
const deliveryAt = (sendTime: SendTime): KindleDelivery =>
  Schema.decodeSync(KindleDelivery)({
    kindleEmail: 'reader@kindle.com',
    senderEmail: 'me@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    sendTime,
  });

/** Stores one owner whose next send is the given instant (KD-SCHED-1). */
const save = (
  store: Store,
  sendTime: SendTime,
  at: number,
  owner = alice
): Effect.Effect<void, unknown> =>
  Context.get(store, SettingRepository).setKindle(
    owner,
    deliveryAt(sendTime),
    Option.none(),
    Option.some(instant(at))
  );

/** The stored next send of one owner as epoch milliseconds (KD-SCHED-1). */
const nextSendOf = (store: Store, owner = alice) =>
  Effect.map(Context.get(store, SettingRepository).get(owner), (setting) =>
    Option.map(setting.nextSendAt, DateTime.toEpochMillis)
  );

/** The scheduler over the store and a sender, forked until the test ends. */
const launch = (store: Store, sender: Layer.Layer<KindleSender>) =>
  Layer.launch(KindleSchedulerLive).pipe(
    Effect.provide(Layer.merge(Layer.succeedContext(store), sender)),
    Effect.forkScoped
  );

/** A sender that records the owners it is asked to send and never mails. */
const recordedSender = (sent: Ref.Ref<ReadonlyArray<string>>) =>
  Layer.succeed(KindleSender, {
    send: (owner) =>
      Effect.as(
        Ref.update(sent, (owners) => [...owners, owner]),
        { count: 0 }
      ),
  });

describe('the check at start', () => {
  it.effect('KD-SCHED-1 a check at start sends an overdue owner', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(readerStoreDatabaseLayer);
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);
      const now = yield* nowMillis;

      yield* save(store, time('07:00'), now - 1000);
      yield* launch(store, recordedSender(sent));
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([alice]);
      expect(yield* nextSendOf(store)).toEqual(
        Option.some(nextOccurrence(now, time('07:00')))
      );
    })
  );

  it.effect('KD-SCHED-1 an owner due at the next half hour is sent at it', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(readerStoreDatabaseLayer);
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);
      const now = yield* nowMillis;
      const boundary = boundaryAfter(now);
      const sendTime = sendTimeOf(boundary);

      yield* save(store, sendTime, boundary);
      yield* launch(store, recordedSender(sent));
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([]);

      yield* advance(boundary - now);

      expect(yield* Ref.get(sent)).toEqual([alice]);

      const next = Option.getOrThrow(yield* nextSendOf(store));

      expect(next).toBe(nextOccurrence(boundary, sendTime));
      expect(next - boundary).toBeGreaterThan(20 * 3_600_000);
    })
  );
});

describe('the half-hour check', () => {
  it.effect('KD-SCHED-1 an owner due later is not sent yet', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(readerStoreDatabaseLayer);
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);
      const now = yield* nowMillis;
      const at = boundaryAfter(now) + HALF_HOUR;

      yield* save(store, sendTimeOf(at), at);
      yield* launch(store, recordedSender(sent));
      yield* advance(boundaryAfter(now) - now);

      expect(yield* Ref.get(sent)).toEqual([]);
    })
  );

  it.effect('KD-SCHED-2 the check lands on the half-hour boundary', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(readerStoreDatabaseLayer);
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);

      yield* advance(6 * 60_000);

      const now = yield* nowMillis;
      const boundary = boundaryAfter(now);

      yield* save(store, sendTimeOf(boundary), boundary);
      yield* launch(store, recordedSender(sent));
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([]);

      yield* advance(boundary - now - 60_000);

      expect(yield* Ref.get(sent)).toEqual([]);

      yield* advance(60_000);

      expect(yield* Ref.get(sent)).toEqual([alice]);
    })
  );
});

describe('a busy Kindle send', () => {
  it.effect('KD-SEND-7 a running send is skipped and the loop goes on', () =>
    Effect.gen(function* () {
      const store = yield* Layer.build(readerStoreDatabaseLayer);
      const attempted = yield* Ref.make<ReadonlyArray<string>>([]);
      const sender = Layer.succeed(KindleSender, {
        send: (owner) =>
          Effect.andThen(
            Ref.update(attempted, (owners) => [...owners, owner]),
            Effect.fail(new KindleSendInProgress())
          ),
      });
      const now = yield* nowMillis;
      const sendTime = time('07:00');
      const next = nextOccurrence(now, sendTime);

      yield* save(store, sendTime, now - 1000, alice);
      yield* save(store, sendTime, now - 1000, bob);
      yield* launch(store, sender);
      yield* settle;

      expect(Array.from(yield* Ref.get(attempted)).sort()).toEqual([
        alice,
        bob,
      ]);
      expect(yield* nextSendOf(store, alice)).toEqual(Option.some(next));

      yield* advance(next - now + HALF_HOUR);

      expect(Array.from(yield* Ref.get(attempted)).sort()).toEqual([
        alice,
        alice,
        bob,
        bob,
      ]);
    })
  );
});
