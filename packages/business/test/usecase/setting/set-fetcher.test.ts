import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted, Schema } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';
import {
  FetcherInput,
  setFetcher,
} from '../../../src/usecase/setting/set-fetcher';
import { MemorySettingRepositoryLive } from '../../port/memory-setting-repository';
import { alice, decodeBrowserEndpoint, decodeJinaKey } from '../../support';

const decodeInput = Schema.decodeSync(FetcherInput);

const jinaKey = decodeJinaKey('jina-secret');

const otherKey = decodeJinaKey('other-secret');

const endpoint = decodeBrowserEndpoint('http://127.0.0.1:9222/devtools');

const otherEndpoint = decodeBrowserEndpoint('ws://127.0.0.1:9333/devtools');

const endpointHref = Redacted.value(endpoint).href;

const otherEndpointHref = Redacted.value(otherEndpoint).href;

const storedKey = (setting: Setting): string | undefined => {
  const key = setting.fetcher.jina.key;

  return Option.isSome(key) ? Redacted.value(key.value) : undefined;
};

const storedEndpoint = (setting: Setting): string | undefined => {
  const stored = setting.fetcher.browser.endpoint;

  return Option.isSome(stored) ? Redacted.value(stored.value).href : undefined;
};

const run = <A, E>(effect: Effect.Effect<A, E, SettingRepository>) =>
  effect.pipe(Effect.provide(MemorySettingRepositoryLive));

describe('setFetcher jina', () => {
  it.effect('SET-FETCH-1 stores a given key and keeps the endpoint', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: {
          provider: 'browser',
          jina: { key: Option.some(otherKey) },
          browser: { endpoint: Option.some(endpoint) },
        },
      });
      yield* setFetcher(
        alice,
        decodeInput({ provider: 'jina', key: 'new-secret' })
      );

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedKey(setting)).toBe('new-secret');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );

  it.effect('SET-FETCH-1 keeps a stored key when none is given', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: { jina: { key: Option.some(jinaKey) } },
      });
      yield* setFetcher(alice, decodeInput({ provider: 'jina' }));

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedKey(setting)).toBe('jina-secret');
    }).pipe(run)
  );
});

describe('setFetcher browser', () => {
  it.effect('SET-FETCH-2 stores a given endpoint and keeps the key', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: { jina: { key: Option.some(jinaKey) } },
      });
      yield* setFetcher(
        alice,
        decodeInput({ provider: 'browser', endpoint: otherEndpointHref })
      );

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('browser');
      expect(storedEndpoint(setting)).toBe(otherEndpointHref);
      expect(storedKey(setting)).toBe('jina-secret');
    }).pipe(run)
  );

  it.effect('SET-FETCH-2 keeps a stored endpoint when none is given', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: { browser: { endpoint: Option.some(endpoint) } },
      });
      yield* setFetcher(alice, decodeInput({ provider: 'browser' }));

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('browser');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );
});

describe('setFetcher browser without endpoint', () => {
  it.effect('SET-FETCH-3 fails and stores nothing', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      const error = yield* setFetcher(
        alice,
        decodeInput({ provider: 'browser' })
      ).pipe(Effect.flip);

      expect(error._tag).toBe('BrowserEndpointRequired');

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedEndpoint(setting)).toBeUndefined();
    }).pipe(run)
  );
});

describe('setFetcher provider switch', () => {
  it.effect('SET-FETCH-5 keeps both provider configurations', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* setFetcher(
        alice,
        decodeInput({ provider: 'browser', endpoint: endpointHref })
      );
      yield* setFetcher(alice, decodeInput({ provider: 'jina', key: 'key' }));

      const jina = yield* repository.get(alice);

      expect(jina.fetcher.provider).toBe('jina');
      expect(storedEndpoint(jina)).toBe(endpointHref);

      yield* setFetcher(alice, decodeInput({ provider: 'browser' }));

      const browser = yield* repository.get(alice);

      expect(browser.fetcher.provider).toBe('browser');
      expect(storedKey(browser)).toBe('key');
    }).pipe(run)
  );
});

describe('SET-KEY', () => {
  it.effect('clears the stored key through the port and keeps the rest', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: {
          provider: 'browser',
          jina: { key: Option.some(jinaKey) },
          browser: { endpoint: Option.some(endpoint) },
        },
      });
      yield* repository.update(alice, {
        fetcher: { jina: { key: Option.none() } },
      });

      const setting = yield* repository.get(alice);

      expect(storedKey(setting)).toBeUndefined();
      expect(setting.fetcher.provider).toBe('browser');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );

  it.effect('changes nothing observable when no key is stored', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.update(alice, {
        fetcher: { jina: { key: Option.none() } },
      });

      const setting = yield* repository.get(alice);

      expect(storedKey(setting)).toBeUndefined();
      expect(setting.fetcher.provider).toBe('jina');
      expect(storedEndpoint(setting)).toBeUndefined();
      expect(setting.feed.retention).toBe(100);
    }).pipe(run)
  );
});
