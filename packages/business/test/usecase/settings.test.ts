// biome-ignore-all lint/style/noExcessiveLinesPerFile: settings tests share one set of repository mocks and layers.
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Redacted } from 'effect';
import { OwnerId } from '../../src/entity/object-value';
import {
  SettingsRepository,
  SettingsRepositoryError,
  type SettingsRepositoryUpdate,
  type SettingsRepositoryValue,
} from '../../src/port/settings-repository';
import {
  getSettings,
  updateExtraction,
  updateRetention,
} from '../../src/usecase/settings';

const owner = OwnerId.make('alice');

type SettingsMock = {
  readonly get?: (
    owner: OwnerId
  ) => Effect.Effect<SettingsRepositoryValue, SettingsRepositoryError>;
  readonly save?: (
    owner: OwnerId,
    update: SettingsRepositoryUpdate
  ) => Effect.Effect<void, SettingsRepositoryError>;
  readonly setRetention?: (
    owner: OwnerId,
    value: number
  ) => Effect.Effect<void, SettingsRepositoryError>;
};

const settingsLayer = (handlers: SettingsMock) =>
  Layer.mock(SettingsRepository, handlers);

it.effect('returns retention with extraction settings', () =>
  Effect.gen(function* () {
    expect(yield* getSettings(owner)).toEqual({
      retention: 120,
      provider: 'browser',
      jinaConfigured: true,
      browserEndpoint: Option.some('ws://127.0.0.1:9222'),
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () =>
          Effect.succeed({
            retention: 120,
            provider: 'browser',
            jinaConfigured: true,
            browserEndpoint: Option.some('ws://127.0.0.1:9222'),
          }),
      })
    )
  )
);

it.effect('returns no endpoint option when none is stored', () =>
  Effect.gen(function* () {
    expect(yield* getSettings(owner)).toEqual({
      retention: 100,
      provider: 'jina',
      jinaConfigured: false,
      browserEndpoint: Option.none(),
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () =>
          Effect.succeed({
            retention: 100,
            provider: 'jina',
            jinaConfigured: false,
            browserEndpoint: Option.none(),
          }),
      })
    )
  )
);

it.effect('maps settings read failures', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(getSettings(owner));
    expect(error._tag).toBe('SettingsReadError');
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () => Effect.fail(new SettingsRepositoryError({ error: 'read' })),
      })
    )
  )
);

it.effect('persists valid retention choices', () => {
  const saved: number[] = [];

  return Effect.gen(function* () {
    for (const value of [30, 100, 300]) {
      expect(yield* updateRetention(owner, value)).toEqual({ ok: true });
    }

    expect(saved).toEqual([30, 100, 300]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        setRetention: (_owner, value) => {
          saved.push(value);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('maps retention save failures', () => {
  return Effect.gen(function* () {
    const error = yield* Effect.flip(updateRetention(owner, 120));
    expect(error._tag).toBe('SettingsSaveError');
  }).pipe(
    Effect.provide(
      settingsLayer({
        setRetention: () =>
          Effect.fail(new SettingsRepositoryError({ error: 'write' })),
      })
    )
  );
});

it.effect('rejects retention outside the supported integer range', () => {
  const values = [29, 301, 30.5, Number.NaN, Number.POSITIVE_INFINITY];

  return Effect.gen(function* () {
    for (const value of values) {
      const error = yield* Effect.flip(updateRetention(owner, value));
      expect(error._tag).toBe('InvalidRetention');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        setRetention: () => Effect.die('invalid retention must not persist'),
      })
    )
  );
});

it.effect('saves extraction settings in one atomic update', () => {
  const saved: SettingsRepositoryUpdate[] = [];

  return Effect.gen(function* () {
    expect(
      yield* updateExtraction(owner, {
        provider: 'jina',
        jinaKey: '  secret  ',
        browserEndpoint: '  http://127.0.0.1:9222  ',
      })
    ).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    const update = saved[0];
    expect(update?.provider).toBe('jina');
    expect(update?.browserEndpoint).toEqual(
      Option.some('http://127.0.0.1:9222')
    );
    expect(update && Option.isSome(update.key)).toBe(true);
    if (update && Option.isSome(update.key)) {
      expect(Redacted.value(update.key.value)).toBe('secret');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: (_owner, update) => {
          saved.push(update);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('preserves omitted extraction fields', () => {
  const saved: SettingsRepositoryUpdate[] = [];

  return Effect.gen(function* () {
    yield* updateExtraction(owner, { provider: 'jina' });
    expect(saved).toEqual([
      {
        provider: 'jina',
        key: Option.none(),
        browserEndpoint: Option.none(),
      },
    ]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: (_owner, update) => {
          saved.push(update);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('accepts browser endpoints and requires one for browser', () => {
  const saved: SettingsRepositoryUpdate[] = [];
  const endpoints = [
    'http://127.0.0.1:9222',
    'https://browser.example.com/devtools',
    'ws://10.0.0.5:9222',
    'wss://browser.internal:9222',
  ];

  return Effect.gen(function* () {
    for (const browserEndpoint of endpoints) {
      yield* updateExtraction(owner, { provider: 'browser', browserEndpoint });
    }
    expect(
      saved.map((update) => Option.getOrUndefined(update.browserEndpoint))
    ).toEqual(endpoints);

    for (const browserEndpoint of [undefined, '', '   ']) {
      const error = yield* Effect.flip(
        updateExtraction(owner, {
          provider: 'browser',
          ...(browserEndpoint === undefined ? {} : { browserEndpoint }),
        })
      );
      expect(error._tag).toBe('InvalidEndpoint');
    }
    expect(saved).toHaveLength(endpoints.length);
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: (_owner, update) => {
          saved.push(update);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('rejects invalid browser endpoints', () => {
  const endpoints = [
    'not-a-url',
    'ftp://127.0.0.1:9222',
    'file:///tmp/browser',
    'http://user:secret@127.0.0.1:9222',
    'https://browser.example.com/#devtools',
    'https://browser.example.com/#',
    `https://browser.example.com/${'a'.repeat(2048)}`,
  ];

  return Effect.gen(function* () {
    for (const browserEndpoint of endpoints) {
      const error = yield* Effect.flip(
        updateExtraction(owner, { provider: 'jina', browserEndpoint })
      );
      expect(error._tag).toBe('InvalidEndpoint');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: () => Effect.die('invalid endpoint must not persist'),
      })
    )
  );
});

it.effect('clears the browser endpoint with an empty value', () => {
  const saved: SettingsRepositoryUpdate[] = [];

  return Effect.gen(function* () {
    yield* updateExtraction(owner, { provider: 'jina', browserEndpoint: '  ' });
    expect(saved).toEqual([
      {
        provider: 'jina',
        key: Option.none(),
        browserEndpoint: Option.some(''),
      },
    ]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: (_owner, update) => {
          saved.push(update);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('rejects blank, multiline, and oversized keys', () => {
  const keys = ['', '   ', 'line\nbreak', 'line\rbreak', 'a'.repeat(2049)];

  return Effect.gen(function* () {
    for (const jinaKey of keys) {
      const error = yield* Effect.flip(
        updateExtraction(owner, { provider: 'jina', jinaKey })
      );
      expect(error._tag).toBe('InvalidKey');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: () => Effect.die('invalid key must not persist'),
      })
    )
  );
});

it.effect('rejects unknown providers', () => {
  return Effect.gen(function* () {
    for (const provider of ['', 'other', 'JINA']) {
      const error = yield* Effect.flip(updateExtraction(owner, { provider }));
      expect(error._tag).toBe('InvalidProvider');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: () => Effect.die('invalid provider must not persist'),
      })
    )
  );
});

it.effect('maps extraction save failures', () => {
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      updateExtraction(owner, { provider: 'jina' })
    );
    expect(error._tag).toBe('SettingsSaveError');
  }).pipe(
    Effect.provide(
      settingsLayer({
        save: () =>
          Effect.fail(new SettingsRepositoryError({ error: 'write' })),
      })
    )
  );
});
