import { expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Schema } from 'effect';
import { Retention } from '../../src/entity/setting/feed';
import { BrowserEndpoint } from '../../src/entity/setting/fetcher';
import type { Setting } from '../../src/entity/setting/setting';
import {
  type SettingsPatch,
  SettingsRepository,
} from '../../src/port/settings-repository';
import { updateSettings } from '../../src/usecase/settings';
import { alice } from '../support';

const endpoint = Schema.decodeSync(BrowserEndpoint)('http://127.0.0.1:9222');

const current = (
  provider: 'jina' | 'browser',
  browserEndpoint: Option.Option<BrowserEndpoint> = Option.none()
): Setting => ({
  ownerId: alice,
  feed: { retention: Retention.make(100) },
  fetcher: {
    provider,
    jina: { key: Option.none() },
    browser: { endpoint: browserEndpoint },
  },
});

const run = (setting: Setting, patch: SettingsPatch) => {
  const updates: Array<SettingsPatch> = [];
  const layer = Layer.mock(SettingsRepository, {
    get: () => Effect.succeed(setting),
    update: (_owner, received) => {
      updates.push(received);

      return Effect.void;
    },
  });

  return {
    updates,
    result: updateSettings(alice, patch).pipe(Effect.provide(layer)),
  };
};

it.effect('stores a patch that keeps the provider valid', () => {
  const patch: SettingsPatch = { feed: { retention: Retention.make(200) } };
  const { updates, result } = run(current('jina'), patch);

  return Effect.gen(function* () {
    yield* result;
    expect(updates).toEqual([patch]);
  });
});

it.effect('rejects switching to browser without an endpoint', () => {
  const { updates, result } = run(current('jina'), {
    fetcher: { provider: 'browser' },
  });

  return Effect.gen(function* () {
    const error = yield* Effect.flip(result);
    expect(error._tag).toBe('BrowserEndpointRequired');
    expect(updates).toEqual([]);
  });
});

it.effect('accepts browser with an endpoint from the patch or the store', () =>
  Effect.gen(function* () {
    const fromPatch = run(current('jina'), {
      fetcher: {
        provider: 'browser',
        browser: { endpoint: Option.some(endpoint) },
      },
    });
    yield* fromPatch.result;
    expect(fromPatch.updates).toHaveLength(1);

    const fromStore = run(current('jina', Option.some(endpoint)), {
      fetcher: { provider: 'browser' },
    });
    yield* fromStore.result;
    expect(fromStore.updates).toHaveLength(1);
  })
);

it.effect('rejects clearing the endpoint while browser is active', () => {
  const { updates, result } = run(current('browser', Option.some(endpoint)), {
    fetcher: { browser: { endpoint: Option.none() } },
  });

  return Effect.gen(function* () {
    const error = yield* Effect.flip(result);
    expect(error._tag).toBe('BrowserEndpointRequired');
    expect(updates).toEqual([]);
  });
});

it.effect('allows clearing the endpoint while jina is active', () => {
  const { updates, result } = run(current('jina', Option.some(endpoint)), {
    fetcher: { browser: { endpoint: Option.none() } },
  });

  return Effect.gen(function* () {
    yield* result;
    expect(updates).toHaveLength(1);
  });
});
