// biome-ignore-all lint/style/noExcessiveLinesPerFile: settings tests share one set of repository mocks and layers.
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Redacted } from 'effect';
import { OwnerId } from '../../src/entity/object-value';
import {
  type SettingsPatch,
  SettingsRepository,
  SettingsRepositoryError,
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
  readonly update?: (
    owner: OwnerId,
    settingsPatch: SettingsPatch
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
            jinaKey: Option.some(Redacted.make('secret')),
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
            jinaKey: Option.none(),
            browserEndpoint: Option.none(),
          }),
      })
    )
  )
);

it.effect('maps settings read failures', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(getSettings(owner));
    expect(error).toMatchObject({
      _tag: 'SettingsReadError',
      message: 'Failed to read settings',
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () =>
          Effect.fail(new SettingsRepositoryError({ message: 'read' })),
      })
    )
  )
);

it.effect('persists valid retention choices', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    for (const value of [30, 100, 300]) {
      expect(yield* updateRetention(owner, value)).toEqual({ ok: true });
    }

    expect(saved).toEqual([
      { retention: 30 },
      { retention: 100 },
      { retention: 300 },
    ]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: (_owner, value) => {
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
    expect(error).toMatchObject({
      _tag: 'SettingsSaveError',
      message: 'Failed to save settings',
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: () =>
          Effect.fail(new SettingsRepositoryError({ message: 'write' })),
      })
    )
  );
});

it.effect('rejects retention outside the supported integer range', () => {
  const values = [29, 301, 30.5, Number.NaN, Number.POSITIVE_INFINITY];

  return Effect.gen(function* () {
    for (const value of values) {
      const error = yield* Effect.flip(updateRetention(owner, value));
      expect(error).toMatchObject({
        _tag: 'InvalidRetention',
        message: 'Retention must be an integer between 30 and 300',
      });
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: () => Effect.die('invalid retention must not persist'),
      })
    )
  );
});

it.effect('saves extraction settings in one atomic update', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    expect(
      yield* updateExtraction(owner, {
        provider: 'jina',
        jinaKey: '  secret  ',
        browserEndpoint: '  http://127.0.0.1:9222  ',
      })
    ).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    const settingsPatch = saved[0];
    expect(settingsPatch?.provider).toBe('jina');
    expect(settingsPatch?.browserEndpoint).toEqual(
      Option.some('http://127.0.0.1:9222')
    );
    expect(settingsPatch?.jinaKey && Option.isSome(settingsPatch.jinaKey)).toBe(
      true
    );
    if (settingsPatch?.jinaKey && Option.isSome(settingsPatch.jinaKey)) {
      expect(Redacted.value(settingsPatch.jinaKey.value)).toBe('secret');
    }
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: (_owner, settingsPatch) => {
          saved.push(settingsPatch);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('preserves omitted extraction fields', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    yield* updateExtraction(owner, { provider: 'jina' });
    expect(saved).toEqual([
      {
        provider: 'jina',
      },
    ]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: (_owner, settingsPatch) => {
          saved.push(settingsPatch);

          return Effect.void;
        },
      })
    )
  );
});

it.effect('accepts browser endpoints and requires one for browser', () => {
  const saved: Array<SettingsPatch> = [];
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
      saved.map((settingsPatch) =>
        Option.getOrUndefined(settingsPatch.browserEndpoint ?? Option.none())
      )
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
        update: (_owner, settingsPatch) => {
          saved.push(settingsPatch);

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
        update: () => Effect.die('invalid endpoint must not persist'),
      })
    )
  );
});

it.effect('clears the browser endpoint with an empty value', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    yield* updateExtraction(owner, { provider: 'jina', browserEndpoint: '  ' });
    expect(saved).toEqual([
      {
        provider: 'jina',
        browserEndpoint: Option.none(),
      },
    ]);
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: (_owner, settingsPatch) => {
          saved.push(settingsPatch);

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
        update: () => Effect.die('invalid key must not persist'),
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
        update: () => Effect.die('invalid provider must not persist'),
      })
    )
  );
});

it.effect('maps extraction save failures', () => {
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      updateExtraction(owner, { provider: 'jina' })
    );
    expect(error).toMatchObject({
      _tag: 'SettingsSaveError',
      message: 'Failed to save settings',
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        update: () =>
          Effect.fail(new SettingsRepositoryError({ message: 'write' })),
      })
    )
  );
});
