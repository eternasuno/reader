import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Option, Redacted } from 'effect';
import type {
  KindleDelivery,
  SmtpPassword,
} from '../../../../src/entity/setting/kindle';
import type { Setting } from '../../../../src/entity/setting/setting';
import {
  type ISettingRepository,
  SettingRepository,
} from '../../../../src/port/setting-repository';
import {
  alice,
  bob,
  decodeEmailAddress,
  decodeJinaKey,
  decodeRetention,
  decodeSendTime,
  decodeSmtpPassword,
  decodeSmtpPort,
  kindleDelivery,
  sendAt,
} from '../../fixtures';
import type { SettingStoreFactory } from '../layer';

const password = decodeSmtpPassword('smtp-secret');

/** One instant of the Kindle schedule (KD-SCHED-1). */
const scheduled = sendAt('2026-01-02T07:00:00.000Z');

/** A later one, the next send of a rescheduled owner. */
const later = sendAt('2026-01-03T07:00:00.000Z');

const epochOf = (at: DateTime.Utc): number => DateTime.toEpochMillis(at);

const kindleOf = (setting: Setting): KindleDelivery | undefined =>
  Option.getOrUndefined(setting.kindle);

const passwordOf = (setting: Setting): string | undefined =>
  Option.map(setting.smtpPassword, (stored) => Redacted.value(stored)).pipe(
    Option.getOrUndefined
  );

const instantOf = (setting: Setting): number | undefined =>
  Option.map(setting.nextSendAt, epochOf).pipe(Option.getOrUndefined);

/** Writes one owner's delivery with the default password and next send unless given (SET-KINDLE-3). */
const save = (
  settings: ISettingRepository,
  kindle: KindleDelivery = kindleDelivery(),
  nextSendAt: Option.Option<DateTime.Utc> = Option.none(),
  given: Option.Option<SmtpPassword> = Option.some(password),
  owner = alice
) => settings.setKindle(owner, kindle, given, nextSendAt);

const freshCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-KINDLE-5 a user who never saved the group has no delivery',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;
        const setting = yield* settings.get(alice);

        expect(setting.kindle).toStrictEqual(Option.none());
        expect(setting.smtpPassword).toStrictEqual(Option.none());
        expect(setting.nextSendAt).toStrictEqual(Option.none());
      }).pipe(Effect.provide(makeLayer()))
  );
};

const saveCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-KINDLE-3 setKindle writes the group and a given password',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;
        const kindle = kindleDelivery({
          sendTime: Option.some(decodeSendTime('07:00')),
        });

        yield* save(settings, kindle, Option.some(scheduled));

        const setting = yield* settings.get(alice);

        expect(kindleOf(setting)).toStrictEqual(kindle);
        expect(passwordOf(setting)).toBe('smtp-secret');
        expect(instantOf(setting)).toBe(epochOf(scheduled));
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SET-KINDLE-3 a save without a password keeps the stored one', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const second = kindleDelivery({
        kindleEmail: decodeEmailAddress('other@example.com'),
        smtpPort: decodeSmtpPort(587),
        smtpSecurity: 'starttls',
      });

      yield* save(settings, kindleDelivery(), Option.some(later));
      yield* save(settings, second, Option.some(later), Option.none());

      const setting = yield* settings.get(alice);

      expect(kindleOf(setting)).toStrictEqual(second);
      expect(passwordOf(setting)).toBe('smtp-secret');
      expect(instantOf(setting)).toBe(epochOf(later));
    }).pipe(Effect.provide(makeLayer()))
  );
};

const nextSendCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('KD-SCHED-1 a save without a send time writes no next send', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* save(settings);

      expect(instantOf(yield* settings.get(alice))).toBeUndefined();
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('KD-SCHED-1 a later save replaces the stored next send', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* save(settings, kindleDelivery(), Option.some(scheduled));
      yield* save(settings, kindleDelivery(), Option.some(later));

      expect(instantOf(yield* settings.get(alice))).toBe(epochOf(later));
    }).pipe(Effect.provide(makeLayer()))
  );
};

const leaveAloneCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('CM-PORT-3 setKindle leaves every other field as it is', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.setRetention(alice, decodeRetention(250));
      yield* settings.selectJinaWithKey(alice, decodeJinaKey('jina-secret'));
      yield* save(settings, kindleDelivery(), Option.some(later));

      const setting = yield* settings.get(alice);

      expect(setting.retention).toBe(250);
      expect(setting.provider).toBe('jina');
      expect(Option.getOrUndefined(setting.jinaKey)).toBeDefined();
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-PORT-3 the other writes leave the Kindle delivery as it is',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;
        const kindle = kindleDelivery();

        yield* save(settings, kindle, Option.some(later));
        yield* settings.setRetention(alice, decodeRetention(30));
        yield* settings.selectBrowser(alice);
        yield* settings.clearJinaKey(alice);

        const setting = yield* settings.get(alice);

        expect(kindleOf(setting)).toStrictEqual(kindle);
        expect(passwordOf(setting)).toBe('smtp-secret');
        expect(instantOf(setting)).toBe(epochOf(later));
      }).pipe(Effect.provide(makeLayer()))
  );
};

const clearCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-KINDLE-4 clearSmtpPassword removes the password and keeps the group',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;
        const kindle = kindleDelivery();

        yield* save(settings, kindle, Option.some(later));
        yield* settings.clearSmtpPassword(alice);

        const setting = yield* settings.get(alice);

        expect(setting.smtpPassword).toStrictEqual(Option.none());
        expect(kindleOf(setting)).toStrictEqual(kindle);
        expect(instantOf(setting)).toBe(epochOf(later));
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'SET-KINDLE-4 clearSmtpPassword succeeds when no password is stored',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.setRetention(alice, decodeRetention(200));
        const before = yield* settings.get(alice);

        yield* settings.clearSmtpPassword(alice);

        expect(yield* settings.get(alice)).toStrictEqual(before);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const passwordCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('SET-KINDLE-2 the password is read back exactly as typed', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.setKindle(
        alice,
        kindleDelivery(),
        Option.some(decodeSmtpPassword('  pass word  ')),
        Option.none()
      );
      yield* settings.setKindle(
        bob,
        kindleDelivery(),
        Option.some(decodeSmtpPassword('   ')),
        Option.none()
      );

      expect(passwordOf(yield* settings.get(alice))).toBe('  pass word  ');
      expect(passwordOf(yield* settings.get(bob))).toBe('   ');
    }).pipe(Effect.provide(makeLayer()))
  );
};

const otherOwnerCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('SET-OWN-1 another owner keeps their own delivery', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const kindle = kindleDelivery();

      yield* save(settings, kindle, Option.some(later));
      yield* save(
        settings,
        kindleDelivery({ kindleEmail: decodeEmailAddress('bob@example.com') }),
        Option.none(),
        Option.none(),
        bob
      );

      const mine = yield* settings.get(alice);
      const other = yield* settings.get(bob);

      expect(kindleOf(mine)).toStrictEqual(kindle);
      expect(passwordOf(mine)).toBe('smtp-secret');
      expect(instantOf(mine)).toBe(epochOf(later));
      expect(kindleOf(other)?.kindleEmail).toBe('bob@example.com');
      expect(passwordOf(other)).toBeUndefined();
      expect(instantOf(other)).toBeUndefined();
    }).pipe(Effect.provide(makeLayer()))
  );
};

/** The Kindle cases of the `SettingRepository` contract (SET-KINDLE, KD-SCHED-1). */
export const kindleCases = (makeLayer: SettingStoreFactory) => (): void => {
  describe('get', freshCases(makeLayer));
  describe('setKindle', saveCases(makeLayer));
  describe('the next send', nextSendCases(makeLayer));
  describe('setKindle beside the other writes', leaveAloneCases(makeLayer));
  describe('clearSmtpPassword', clearCases(makeLayer));
  describe('password as typed', passwordCases(makeLayer));
  describe('ownership', otherOwnerCases(makeLayer));
};
