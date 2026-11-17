import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { SettingRepository } from '../../../src/port/setting-repository';
import { useJina } from '../../../src/usecase/setting/use-jina';
import { alice } from '../../support/fixtures';
import {
  endpoint,
  endpointHref,
  jinaKey,
  runSettings,
  storedEndpoint,
  storedKey,
} from './harness';

describe('useJina', () => {
  it.effect('SET-FETCH-1 stores the provider and the given key', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* useJina(alice, Option.some(jinaKey));

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(storedKey(setting)).toBe('jina-secret');
      })
    )
  );

  it.effect('SET-FETCH-1 keeps the stored key when none is given', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectJinaWithKey(alice, jinaKey);
        yield* useJina(alice, Option.none());

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(storedKey(setting)).toBe('jina-secret');
      })
    )
  );

  it.effect('SET-FETCH-5 leaves the stored browser endpoint untouched', () =>
    runSettings(
      Effect.gen(function* () {
        const settings = yield* SettingRepository;

        yield* settings.selectBrowserWithEndpoint(alice, endpoint);
        yield* useJina(alice, Option.some(jinaKey));

        const setting = yield* settings.get(alice);

        expect(setting.provider).toBe('jina');
        expect(storedEndpoint(setting)).toBe(endpointHref);
        expect(storedKey(setting)).toBe('jina-secret');
      })
    )
  );
});
