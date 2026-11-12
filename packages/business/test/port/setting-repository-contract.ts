import { describe, expect, it } from '@effect/vitest';
import { Effect, type Layer, Option, Redacted } from 'effect';
import type { Setting } from '../../src/entity/setting/setting';
import { SettingRepository } from '../../src/port/setting-repository';
import {
  alice,
  bob,
  decodeBrowserEndpoint,
  decodeJinaKey,
  decodeRetention,
} from '../support';

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

const registerMerge = (run: Run) =>
  it.effect('merges only the given leaf fields', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* repository.update(alice, {
          fetcher: { jina: { key: Option.some(jinaKey) } },
        });
        yield* repository.update(alice, {
          feed: { retention: decodeRetention(250) },
        });
        yield* repository.update(alice, {
          fetcher: { browser: { endpoint: Option.some(endpoint) } },
        });

        const setting = yield* repository.get(alice);

        expect(setting.feed.retention).toBe(250);
        expect(setting.fetcher.provider).toBe('jina');
        expect(keyOf(setting)).toBe('jina-secret');
        expect(endpointOf(setting)).toBe(endpointHref);
      })
    )
  );

const registerClear = (run: Run) =>
  it.effect('clears an optional leaf with none and keeps the rest', () =>
    run(
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

        expect(setting.fetcher.provider).toBe('browser');
        expect(keyOf(setting)).toBeUndefined();
        expect(endpointOf(setting)).toBe(endpointHref);
      })
    )
  );

const registerEmptyPatch = (run: Run) =>
  it.effect('writes nothing for a patch without leaf fields', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* repository.update(alice, {
          feed: { retention: decodeRetention(200) },
        });
        yield* repository.update(alice, {});
        yield* repository.update(alice, { feed: {} });
        yield* repository.update(alice, { fetcher: { jina: {} } });

        const setting = yield* repository.get(alice);

        expect(setting.feed.retention).toBe(200);
        expect(setting.fetcher.provider).toBe('jina');
        expect(keyOf(setting)).toBeUndefined();
      })
    )
  );

const registerConcurrent = (run: Run) =>
  it.effect('keeps two concurrent updates of different fields', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* Effect.all(
          [
            repository.update(alice, {
              feed: { retention: decodeRetention(250) },
            }),
            repository.update(alice, {
              fetcher: { jina: { key: Option.some(jinaKey) } },
            }),
          ],
          { concurrency: 'unbounded' }
        );

        const setting = yield* repository.get(alice);

        expect(setting.feed.retention).toBe(250);
        expect(keyOf(setting)).toBe('jina-secret');
      })
    )
  );

const registerOwners = (run: Run) =>
  it.effect('keeps the settings of each owner apart', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SettingRepository;

        yield* repository.update(alice, {
          feed: { retention: decodeRetention(300) },
          fetcher: { jina: { key: Option.some(jinaKey) } },
        });

        const other = yield* repository.get(bob);

        expect(other.ownerId).toBe(bob);
        expect(other.feed.retention).toBe(100);
        expect(other.fetcher.provider).toBe('jina');
        expect(keyOf(other)).toBeUndefined();

        yield* repository.update(bob, {
          feed: { retention: decodeRetention(30) },
        });

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
    registerMerge(run);
    registerClear(run);
    registerEmptyPatch(run);
    registerConcurrent(run);
    registerOwners(run);
  });
};
