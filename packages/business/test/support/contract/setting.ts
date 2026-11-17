import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';
import {
  alice,
  bob,
  decodeBrowserEndpoint,
  decodeJinaKey,
  decodeRetention,
} from '../fixtures';
import type { SettingStoreFactory } from './layer';

const jinaKey = decodeJinaKey('jina-secret');

const endpoint = decodeBrowserEndpoint('ws://127.0.0.1:9222');

const endpointHref = 'ws://127.0.0.1:9222/';

const keyOf = (setting: Setting): string | undefined =>
  Option.isSome(setting.jinaKey)
    ? Redacted.value(setting.jinaKey.value)
    : undefined;

const endpointOf = (setting: Setting): string | undefined =>
  Option.isSome(setting.browserEndpoint)
    ? Redacted.value(setting.browserEndpoint.value).href
    : undefined;

const defaultsCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('SET-GET-1 returns the defaults when nothing is stored', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const setting = yield* settings.get(alice);

      expect(setting.ownerId).toBe(alice);
      expect(setting.retention).toBe(100);
      expect(setting.provider).toBe('jina');
      expect(keyOf(setting)).toBeUndefined();
      expect(endpointOf(setting)).toBeUndefined();
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'SET-GET-1 the first write fills the other fields with defaults',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.setRetention(alice, decodeRetention(250));

        const setting = yield* settings.get(alice);

        expect(setting.retention).toBe(250);
        expect(setting.provider).toBe('jina');
        expect(keyOf(setting)).toBeUndefined();
        expect(endpointOf(setting)).toBeUndefined();
      }).pipe(Effect.provide(makeLayer()))
  );
};

const retentionCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('SET-FEED-1 setRetention writes the retention only', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.selectBrowserWithEndpoint(alice, endpoint);
      yield* settings.setRetention(alice, decodeRetention(30));

      const setting = yield* settings.get(alice);

      expect(setting.retention).toBe(30);
      expect(setting.provider).toBe('browser');
      expect(endpointOf(setting)).toBe(endpointHref);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const jinaCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-FETCH-1 selectJinaWithKey writes the provider and the key',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.setRetention(alice, decodeRetention(250));
        yield* settings.selectJinaWithKey(alice, jinaKey);

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(keyOf(setting)).toBe('jina-secret');
        expect(setting.retention).toBe(250);
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SET-FETCH-5 selectJina keeps the stored key and endpoint', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.selectJinaWithKey(alice, jinaKey);
      yield* settings.selectBrowserWithEndpoint(alice, endpoint);
      yield* settings.selectJina(alice);

      const setting = yield* settings.get(alice);

      expect(setting.provider).toBe('jina');
      expect(keyOf(setting)).toBe('jina-secret');
      expect(endpointOf(setting)).toBe(endpointHref);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SET-FETCH-1 selectJinaWithKey replaces the stored key', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.selectJinaWithKey(alice, jinaKey);
      yield* settings.selectJinaWithKey(alice, decodeJinaKey('other-secret'));

      expect(keyOf(yield* settings.get(alice))).toBe('other-secret');
    }).pipe(Effect.provide(makeLayer()))
  );
};

const browserCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-FETCH-2 selectBrowserWithEndpoint writes provider and endpoint',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectJinaWithKey(alice, jinaKey);
        yield* settings.selectBrowserWithEndpoint(alice, endpoint);

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('browser');
        expect(endpointOf(setting)).toBe(endpointHref);
        expect(keyOf(setting)).toBe('jina-secret');
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect('SET-FETCH-5 selectBrowser keeps the stored endpoint and key', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.selectJinaWithKey(alice, jinaKey);
      yield* settings.selectBrowserWithEndpoint(alice, endpoint);
      yield* settings.selectJina(alice);
      yield* settings.selectBrowser(alice);

      const setting = yield* settings.get(alice);

      expect(setting.provider).toBe('browser');
      expect(endpointOf(setting)).toBe(endpointHref);
      expect(keyOf(setting)).toBe('jina-secret');
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'SET-ENDPOINT-2 keeps a configured endpoint while the provider is jina',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectBrowserWithEndpoint(alice, endpoint);
        yield* settings.selectJina(alice);

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(endpointOf(setting)).toBe(endpointHref);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const clearKeyCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect(
    'SET-KEY-1 clearJinaKey removes the key and keeps the provider',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectJinaWithKey(alice, jinaKey);
        yield* settings.selectBrowserWithEndpoint(alice, endpoint);
        yield* settings.clearJinaKey(alice);

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('browser');
        expect(keyOf(setting)).toBeUndefined();
        expect(endpointOf(setting)).toBe(endpointHref);
      }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'SET-KEY-2 clearJinaKey with no key stored changes nothing observable',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.setRetention(alice, decodeRetention(200));
        const before = yield* settings.get(alice);

        yield* settings.clearJinaKey(alice);

        expect(yield* settings.get(alice)).toEqual(before);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const ownerCases = (makeLayer: SettingStoreFactory) => (): void => {
  it.effect('SET-OWN-1 keeps the settings of each owner apart', () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;

      yield* settings.setRetention(alice, decodeRetention(300));
      yield* settings.selectJinaWithKey(alice, jinaKey);

      const other = yield* settings.get(bob);

      expect(other.ownerId).toBe(bob);
      expect(other.retention).toBe(100);
      expect(keyOf(other)).toBeUndefined();

      yield* settings.setRetention(bob, decodeRetention(30));

      const mine = yield* settings.get(alice);

      expect(mine.retention).toBe(300);
      expect(keyOf(mine)).toBe('jina-secret');
      expect((yield* settings.get(bob)).retention).toBe(30);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect(
    'CM-PORT-3 two concurrent writers of different fields both survive',
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* Effect.all(
          [
            settings.setRetention(alice, decodeRetention(250)),
            settings.selectJinaWithKey(alice, jinaKey),
          ],
          { concurrency: 'unbounded' }
        );

        const setting = yield* settings.get(alice);

        expect(setting.retention).toBe(250);
        expect(setting.provider).toBe('jina');
        expect(keyOf(setting)).toBe('jina-secret');
      }).pipe(Effect.provide(makeLayer()))
  );
};

export const settingRepositoryContract = (
  makeLayer: SettingStoreFactory
): void => {
  describe('SettingRepository', () => {
    describe('get', defaultsCases(makeLayer));
    describe('setRetention', retentionCases(makeLayer));
    describe('jina provider', jinaCases(makeLayer));
    describe('browser provider', browserCases(makeLayer));
    describe('clearJinaKey', clearKeyCases(makeLayer));
    describe('owner and concurrent writes', ownerCases(makeLayer));
  });
};
