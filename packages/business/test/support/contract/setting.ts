import { describe, expect, it } from '@effect/vitest';
import { Effect, type Layer, Option, Redacted } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';
import {
  alice,
  bob,
  decodeBrowserEndpoint,
  decodeJinaKey,
  decodeRetention,
} from '../fixtures';

const jinaKey = decodeJinaKey('jina-secret');

const endpoint = decodeBrowserEndpoint('http://127.0.0.1:9222/devtools');

const endpointHref = 'http://127.0.0.1:9222/devtools';

const keyOf = (setting: Setting): string | undefined => {
  const stored = setting.fetcher.jina.key;

  return Option.isSome(stored) ? Redacted.value(stored.value) : undefined;
};

const endpointOf = (setting: Setting): string | undefined => {
  const stored = setting.fetcher.browser.endpoint;

  return Option.isSome(stored) ? Redacted.value(stored.value).href : undefined;
};

type Run = <A, E>(
  effect: Effect.Effect<A, E, SettingRepository>
) => Effect.Effect<A, unknown>;

const registerDefaults = (run: Run) =>
  it.effect('returns the defaults when nothing is stored', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;
        const setting = yield* repository.get(alice);

        expect(setting.ownerId).toBe(alice);
        expect(setting.feed.retention).toBe(100);
        expect(setting.fetcher.provider).toBe('jina');
        expect(keyOf(setting)).toBeUndefined();
        expect(endpointOf(setting)).toBeUndefined();
      })
    )
  );

const registerWriters = (run: Run) =>
  it.effect('each writer sets only its fields and keeps the rest', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* repository.selectJinaWithKey(alice, jinaKey);
        yield* repository.setRetention(alice, decodeRetention(250));
        yield* repository.selectBrowserWithEndpoint(alice, endpoint);

        const setting = yield* repository.get(alice);

        expect(setting.feed.retention).toBe(250);
        expect(setting.fetcher.provider).toBe('browser');
        expect(keyOf(setting)).toBe('jina-secret');
        expect(endpointOf(setting)).toBe(endpointHref);
      })
    )
  );

const registerProviderSwitch = (run: Run) =>
  it.effect(
    'SET-FETCH-5 selectJina and selectBrowser keep the other provider configuration',
    () =>
      run(
        Effect.gen(function* () {
          const repository = yield* SettingRepository;

          yield* repository.selectJinaWithKey(alice, jinaKey);
          yield* repository.selectBrowserWithEndpoint(alice, endpoint);

          yield* repository.selectJina(alice);

          const jina = yield* repository.get(alice);

          expect(jina.fetcher.provider).toBe('jina');
          expect(keyOf(jina)).toBe('jina-secret');
          expect(endpointOf(jina)).toBe(endpointHref);

          yield* repository.selectBrowser(alice);

          const browser = yield* repository.get(alice);

          expect(browser.fetcher.provider).toBe('browser');
          expect(keyOf(browser)).toBe('jina-secret');
          expect(endpointOf(browser)).toBe(endpointHref);
        })
      )
  );

const registerProviderSwitchBack = (run: Run) =>
  it.effect(
    'SET-FETCH-1 SET-FETCH-5 selectJinaWithKey switches back to jina and keeps the endpoint and retention',
    () =>
      run(
        Effect.gen(function* () {
          const repository = yield* SettingRepository;

          yield* repository.setRetention(alice, decodeRetention(250));
          yield* repository.selectJinaWithKey(alice, jinaKey);
          yield* repository.selectBrowserWithEndpoint(alice, endpoint);
          yield* repository.selectJinaWithKey(
            alice,
            decodeJinaKey('new-secret')
          );

          const setting = yield* repository.get(alice);

          expect(setting.fetcher.provider).toBe('jina');
          expect(keyOf(setting)).toBe('new-secret');
          expect(endpointOf(setting)).toBe(endpointHref);
          expect(setting.feed.retention).toBe(250);
        })
      )
  );

const registerClearKey = (run: Run) =>
  it.effect(
    'SET-KEY-1 clearJinaKey removes the key and keeps provider and endpoint',
    () =>
      run(
        Effect.gen(function* () {
          const repository = yield* SettingRepository;

          yield* repository.selectJinaWithKey(alice, jinaKey);
          yield* repository.selectBrowserWithEndpoint(alice, endpoint);
          yield* repository.clearJinaKey(alice);

          const setting = yield* repository.get(alice);

          expect(setting.fetcher.provider).toBe('browser');
          expect(keyOf(setting)).toBeUndefined();
          expect(endpointOf(setting)).toBe(endpointHref);
        })
      )
  );

const registerClearKeyWithoutKey = (run: Run) =>
  it.effect(
    'SET-KEY-2 clearJinaKey with no key stored changes nothing observable',
    () =>
      run(
        Effect.gen(function* () {
          const repository = yield* SettingRepository;

          yield* repository.setRetention(alice, decodeRetention(200));

          const before = yield* repository.get(alice);

          yield* repository.clearJinaKey(alice);

          const after = yield* repository.get(alice);

          expect(after).toEqual(before);
        })
      )
  );

const registerConcurrent = (run: Run) =>
  it.effect('keeps two concurrent writers of different fields', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* Effect.all(
          [
            repository.setRetention(alice, decodeRetention(250)),
            repository.selectJinaWithKey(alice, jinaKey),
          ],
          { concurrency: 'unbounded' }
        );

        const setting = yield* repository.get(alice);

        expect(setting.feed.retention).toBe(250);
        expect(setting.fetcher.provider).toBe('jina');
        expect(keyOf(setting)).toBe('jina-secret');
      })
    )
  );

const registerOwners = (run: Run) =>
  it.effect('keeps the settings of each owner apart', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* repository.setRetention(alice, decodeRetention(300));
        yield* repository.selectJinaWithKey(alice, jinaKey);

        const other = yield* repository.get(bob);

        expect(other.ownerId).toBe(bob);
        expect(other.feed.retention).toBe(100);
        expect(other.fetcher.provider).toBe('jina');
        expect(keyOf(other)).toBeUndefined();

        yield* repository.setRetention(bob, decodeRetention(30));

        const mine = yield* repository.get(alice);

        expect(mine.feed.retention).toBe(300);
        expect(keyOf(mine)).toBe('jina-secret');
      })
    )
  );

export const settingRepositoryContract = (
  layer: Layer.Layer<SettingRepository, unknown>
): void => {
  const run: Run = (effect) => effect.pipe(Effect.provide(layer));

  describe('SettingRepository', () => {
    registerDefaults(run);
    registerWriters(run);
    registerProviderSwitch(run);
    registerProviderSwitchBack(run);
    registerClearKey(run);
    registerClearKeyWithoutKey(run);
    registerConcurrent(run);
    registerOwners(run);
  });
};
