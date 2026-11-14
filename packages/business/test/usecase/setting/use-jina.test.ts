import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Redacted } from 'effect';
import type { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';
import { useJina } from '../../../src/usecase/setting/use-jina';
import {
  alice,
  decodeBrowserEndpoint,
  decodeJinaKey,
} from '../../support/fixtures';
import { MemorySettingRepositoryLive } from '../../support/memory/setting';

const otherKey = decodeJinaKey('other-secret');

const endpoint = decodeBrowserEndpoint('http://127.0.0.1:9222/devtools');

const endpointHref = Redacted.value(endpoint).href;

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

describe('useJina', () => {
  it.effect('SET-FETCH-1 stores a given key and keeps the endpoint', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.selectBrowserWithEndpoint(alice, endpoint);
      yield* repository.selectJinaWithKey(alice, otherKey);
      yield* repository.selectBrowser(alice);
      yield* useJina(alice, decodeJinaKey('new-secret'));

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedKey(setting)).toBe('new-secret');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );

  it.effect('SET-FETCH-1 keeps a stored key when none is given', () =>
    Effect.gen(function* () {
      const repository = yield* SettingRepository;

      yield* repository.selectJinaWithKey(alice, otherKey);
      yield* repository.selectBrowserWithEndpoint(alice, endpoint);
      yield* useJina(alice);

      const setting = yield* repository.get(alice);

      expect(setting.fetcher.provider).toBe('jina');
      expect(storedKey(setting)).toBe('other-secret');
      expect(storedEndpoint(setting)).toBe(endpointHref);
    }).pipe(run)
  );
});
