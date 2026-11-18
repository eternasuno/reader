import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SettingRepository } from '../../../src/port/setting-repository';
import { useBrowser } from '../../../src/usecase/setting/use-browser';
import { alice } from '../../support/fixtures';
import {
  endpoint,
  jinaKey,
  otherEndpoint,
  otherEndpointHref,
  runSettings,
  storedEndpoint,
  storedKey,
} from './harness';

describe('useBrowser', () => {
  it.effect('SET-FETCH-2 stores a given endpoint and keeps the key', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectJinaWithKey(alice, jinaKey);
        yield* useBrowser(alice, Option.some(otherEndpoint));

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('browser');
        expect(storedEndpoint(setting)).toBe(otherEndpointHref);
        expect(storedKey(setting)).toBe('jina-secret');
      })
    )
  );

  it.effect('SET-FETCH-2 keeps the stored endpoint when none is given', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectBrowserWithEndpoint(alice, endpoint);
        yield* settings.selectJina(alice);
        yield* useBrowser(alice, Option.none());

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('browser');
        expect(storedEndpoint(setting)).toBe('ws://127.0.0.1:9222/');
      })
    )
  );

  it.effect('SET-FETCH-3 fails and stores nothing without an endpoint', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;
        const error = yield* useBrowser(alice, Option.none()).pipe(Effect.flip);

        expect(error._tag).toBe('BrowserEndpointRequired');

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(storedEndpoint(setting)).toBeUndefined();
      })
    )
  );
});
