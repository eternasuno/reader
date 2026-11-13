import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';
import { useBrowser } from '../../../src/usecase/setting/use-browser';
import {
  alice,
  decodeBrowserEndpoint,
  decodeJinaKey,
} from '../../support/fixtures';
import { MemorySettingRepositoryLive } from '../../support/memory/setting';

const jinaKey = decodeJinaKey('jina-secret');

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

describe('useBrowser', () => {
  it.effect('SET-FETCH-2 stores a given endpoint and keeps the key', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.selectJinaWithKey(alice, jinaKey);
      yield* useBrowser(alice, otherEndpoint);

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('browser');
      expect(storedEndpoint(setting)).toBe(otherEndpointHref);
      expect(storedKey(setting)).toBe('jina-secret');
    }).pipe(run)
  );

  it.effect('SET-FETCH-2 keeps a stored endpoint when none is given', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.selectBrowserWithEndpoint(alice, endpoint);
      yield* repository.selectJina(alice);
      yield* useBrowser(alice);

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('browser');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );

  it.effect('SET-FETCH-3 fails and stores nothing', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      const error = yield* useBrowser(alice).pipe(Effect.flip);

      expect(error._tag).toBe('BrowserEndpointRequired');

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedEndpoint(setting)).toBeUndefined();
    }).pipe(run)
  );
});
