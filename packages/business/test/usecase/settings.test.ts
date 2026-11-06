// biome-ignore-all lint/style/noExcessiveLinesPerFile: settings tests share one set of repository mocks and layers.
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import { OwnerId } from '../../src/entity/object-value';
import {
  BrowserEndpoint,
  Retention,
  type Setting,
} from '../../src/entity/setting';
import {
  type SettingsPatch,
  SettingsRepository,
  SettingsRepositoryError,
} from '../../src/port/settings-repository';
import {
  getSettings,
  updateExtraction,
  updateRetention,
} from '../../src/usecase/settings';

const owner = OwnerId.make('alice');

const decodeRetention = Schema.decodeSync(Retention);

const decodeBrowserEndpoint = Schema.decodeSync(BrowserEndpoint);

type SettingsMock = {
  readonly get?: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingsRepositoryError>;
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
      ownerId: owner,
      retention: 120,
      provider: 'browser',
      jinaKey: Option.some(Redacted.make('secret')),
      browserEndpoint: Option.some('ws://127.0.0.1:9222'),
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () =>
          Effect.succeed({
            ownerId: owner,
            retention: decodeRetention(120),
            provider: 'browser',
            jinaKey: Option.some(Redacted.make('secret')),
            browserEndpoint: Option.some(
              decodeBrowserEndpoint('ws://127.0.0.1:9222')
            ),
          }),
      })
    )
  )
);

it.effect('returns no endpoint option when none is stored', () =>
  Effect.gen(function* () {
    expect(yield* getSettings(owner)).toEqual({
      ownerId: owner,
      retention: 100,
      provider: 'jina',
      jinaKey: Option.none(),
      browserEndpoint: Option.none(),
    });
  }).pipe(
    Effect.provide(
      settingsLayer({
        get: () =>
          Effect.succeed({
            ownerId: owner,
            retention: decodeRetention(100),
            provider: 'jina',
            jinaKey: Option.none(),
            browserEndpoint: Option.none(),
          }),
      })
    )
  )
);

it.effect('propagates settings read failures', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(getSettings(owner));
    expect(error).toMatchObject({
      _tag: 'SettingsRepositoryError',
      message: 'read',
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

it.effect('persists validated retention choices', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    for (const value of [30, 100, 300]) {
      const retention = Retention.make(value);
      yield* updateRetention(owner, retention);
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

it.effect('propagates retention save failures', () => {
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      updateRetention(owner, Retention.make(120))
    );
    expect(error).toMatchObject({
      _tag: 'SettingsRepositoryError',
      message: 'write',
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

it.effect('saves decoded extraction settings in one atomic update', () => {
  const saved: Array<SettingsPatch> = [];

  return Effect.gen(function* () {
    yield* updateExtraction(owner, {
      provider: 'jina',
      jinaKey: Option.some(Redacted.make('secret')),
      browserEndpoint: Option.some(
        decodeBrowserEndpoint('http://127.0.0.1:9222')
      ),
    });
    expect(saved).toEqual([
      {
        provider: 'jina',
        jinaKey: Option.some(Redacted.make('secret')),
        browserEndpoint: Option.some('http://127.0.0.1:9222'),
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

it.effect(
  'clears the browser endpoint when the decoded update is empty',
  () => {
    const saved: Array<SettingsPatch> = [];

    return Effect.gen(function* () {
      yield* updateExtraction(owner, {
        provider: 'jina',
        browserEndpoint: Option.none(),
      });
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
  }
);

it.effect('propagates extraction save failures', () => {
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      updateExtraction(owner, {
        provider: 'browser',
        browserEndpoint: Option.some(
          decodeBrowserEndpoint('ws://10.0.0.5:9222')
        ),
      })
    );
    expect(error).toMatchObject({
      _tag: 'SettingsRepositoryError',
      message: 'write',
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
