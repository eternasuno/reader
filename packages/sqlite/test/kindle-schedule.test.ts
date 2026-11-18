import { expect, it } from '@effect/vitest';
import { KindleDelivery, OwnerId, SettingRepository } from '@reader/business';
import { alice, bob, sendAt } from '@reader/business/testing';
import { DateTime, Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { listKindleDue, rescheduleKindle } from '../src';
import { readerStoreDatabaseLayer } from './support';

const carol = OwnerId.make('carol');

const dave = OwnerId.make('dave');

const erin = OwnerId.make('erin');

const grace = OwnerId.make('grace');

/** The instant every case below is checked at (KD-SCHED-2). */
const now = sendAt('2026-01-02T07:00:00.000Z');

const decodeDelivery = Schema.decodeSync(KindleDelivery);

/** A delivery with the given send time, or none (SET-KINDLE-1). */
const deliveryAt = (sendTime?: string): KindleDelivery =>
  decodeDelivery({
    kindleEmail: 'reader@kindle.com',
    senderEmail: 'me@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    ...(sendTime === undefined ? {} : { sendTime }),
  });

it.effect('KD-SCHED-1 lists the owners whose next send is due', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const sql = yield* SqlClient.SqlClient;

    yield* settings.setKindle(
      alice,
      deliveryAt('07:00'),
      Option.none(),
      Option.some(sendAt('2026-01-02T06:00:00.000Z'))
    );
    yield* settings.setKindle(
      bob,
      deliveryAt('07:30'),
      Option.none(),
      Option.some(now)
    );
    // A next send without a delivery is not due.
    yield* sql`INSERT INTO setting (owner, next_send_at) VALUES (${carol}, ${DateTime.toEpochMillis(now)})`;
    // A delivery without a send time is not due.
    yield* settings.setKindle(
      dave,
      deliveryAt(),
      Option.none(),
      Option.some(now)
    );
    // A next send in the future is not due.
    yield* settings.setKindle(
      erin,
      deliveryAt('07:00'),
      Option.none(),
      Option.some(sendAt('2026-01-03T07:00:00.000Z'))
    );
    // A delivery with no next send is not due.
    yield* settings.setKindle(
      grace,
      deliveryAt('07:00'),
      Option.none(),
      Option.none()
    );

    expect(yield* listKindleDue(now)).toEqual([
      { owner: alice, sendTime: '07:00' },
      { owner: bob, sendTime: '07:30' },
    ]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect(
  'KD-SCHED-2 rescheduleKindle moves an owner out of the due list',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const at = sendAt('2026-01-03T07:00:00.000Z');

      yield* settings.setKindle(
        alice,
        deliveryAt('07:00'),
        Option.none(),
        Option.some(now)
      );
      yield* settings.setKindle(
        bob,
        deliveryAt('07:30'),
        Option.none(),
        Option.some(now)
      );

      yield* rescheduleKindle(alice, at);

      expect(yield* listKindleDue(now)).toEqual([
        { owner: bob, sendTime: '07:30' },
      ]);
      expect(yield* listKindleDue(at)).toEqual([
        { owner: bob, sendTime: '07:30' },
        { owner: alice, sendTime: '07:00' },
      ]);
    }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
