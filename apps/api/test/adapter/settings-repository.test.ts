// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one settings boundary.
import { randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  OwnerId,
  Retention,
  type Setting,
  SettingsRepository,
} from '@reader/business';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { readerStoreSchema } from '../../src/adapter/reader-store';
import { SettingsRepositoryLive } from '../../src/adapter/settings-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Services = SettingsRepository | Database;

const owner = Schema.decodeSync(OwnerId)('alice');

const other = Schema.decodeSync(OwnerId)('bob');

const retention = Schema.decodeSync(Retention);

const browserEndpoint = Schema.decodeSync(BrowserEndpoint);

const settingsLive = (db: Surreal) =>
  SettingsRepositoryLive.pipe(Layer.provide(Layer.succeed(Database, db)));

const runWithSettings = <A, E>(check: Effect.Effect<A, E, Services>) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `settings-repository-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(check),
        Effect.provide(
          Layer.mergeAll(settingsLive(db), Layer.succeed(Database, db))
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

const settingRows = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [rows] = yield* Effect.promise(() =>
      db.query<
        [
          Array<{
            id?: string;
            jinaKey?: string;
            provider?: string;
            browserEndpoint?: string;
            retention?: number;
          }>,
        ]
      >(
        'SELECT id, jinaKey, provider, browserEndpoint, retention FROM setting WHERE owner = $owner;',
        { owner: ownerId }
      )
    );

    return rows;
  });

const selectRow = (ownerId: OwnerId) =>
  settingRows(ownerId).pipe(Effect.map((rows) => rows[0]));

const plainSettings = (value: Setting) => ({
  retention: value.retention,
  provider: value.provider,
  browserEndpoint: value.browserEndpoint,
  jinaKey: Option.map(value.jinaKey, (key) => Redacted.value(key)),
});

const corruptField = (
  ownerId: OwnerId,
  field: 'provider' | 'jinaKey' | 'browserEndpoint' | 'retention',
  value: number = 1
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(`UPDATE setting SET ${field} = $value WHERE owner = $owner;`, {
        owner: ownerId,
        value,
      })
    );
  });

const unsetProvider = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query('UPDATE setting SET provider = NONE WHERE owner = $owner;', {
        owner: ownerId,
      })
    );
  });

const setStoredEndpoint = (ownerId: OwnerId, value: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(
        'UPDATE setting SET browserEndpoint = $value WHERE owner = $owner;',
        { owner: ownerId, value }
      )
    );
  });

it.effect('defaults unknown owners to anonymous jina settings', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.none(),
        browserEndpoint: Option.none(),
      });
    })
  )
);

it.effect('does not create settings for an empty patch', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;
      yield* settings.update(owner, {});

      expect(yield* selectRow(owner)).toBeUndefined();
    })
  )
);

it.effect('saves provider, key, endpoint, and retention in one row', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'browser',
        jinaKey: Option.some(Redacted.make('alice-secret')),
        browserEndpoint: Option.some(
          browserEndpoint('  http://127.0.0.1:9222  ')
        ),
        retention: retention(60),
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: retention(60),
        provider: 'browser',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });
      const row = yield* selectRow(owner);
      expect(row?.jinaKey).toBe('alice-secret');
      expect(row?.provider).toBe('browser');
      expect(row?.browserEndpoint).toBe('http://127.0.0.1:9222');
      expect(row?.retention).toBe(60);
    })
  )
);

it.effect('trims stored browser endpoints while loading', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { provider: 'browser' });
      yield* setStoredEndpoint(owner, '  ws://127.0.0.1:9222  ');

      expect((yield* settings.get(owner)).browserEndpoint).toEqual(
        Option.some(browserEndpoint('ws://127.0.0.1:9222'))
      );
    })
  )
);

it.effect('defaults legacy rows without a provider to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        jinaKey: Option.some(Redacted.make('alice-secret')),
      });
      yield* unsetProvider(owner);

      expect((yield* selectRow(owner))?.provider).toBeUndefined();
      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.none(),
      });
    })
  )
);

it.effect('preserves fields omitted from a patch', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'jina',
        jinaKey: Option.some(Redacted.make('secret')),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });
      yield* settings.update(owner, { provider: 'browser' });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.some('secret'),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });

      yield* settings.update(owner, {
        jinaKey: Option.some(Redacted.make('next')),
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.some('next'),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });
    })
  )
);

it.effect(
  'clears the key and endpoint on explicit None without a provider',
  () =>
    runWithSettings(
      Effect.gen(function* () {
        const settings = yield* SettingsRepository;

        yield* settings.update(owner, {
          provider: 'browser',
          jinaKey: Option.some(Redacted.make('alice-secret')),
          browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
        });
        yield* settings.update(owner, {
          jinaKey: Option.none(),
          browserEndpoint: Option.none(),
        });

        expect(plainSettings(yield* settings.get(owner))).toEqual({
          retention: 100,
          provider: 'browser',
          jinaKey: Option.none(),
          browserEndpoint: Option.none(),
        });
        const row = yield* selectRow(owner);
        expect(row?.jinaKey).toBeUndefined();
        expect(row?.browserEndpoint).toBeUndefined();
        expect(row?.provider).toBe('browser');
      })
    )
);

it.effect('clears the key without changing provider or endpoint', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'browser',
        jinaKey: Option.some(Redacted.make('alice-secret')),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
      yield* settings.update(owner, { jinaKey: Option.none() });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.none(),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
    })
  )
);

it.effect('clears the browser endpoint and resets browser to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'browser',
        jinaKey: Option.some(Redacted.make('alice-secret')),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
      yield* settings.update(owner, {
        browserEndpoint: Option.none(),
        provider: 'jina',
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.none(),
      });
    })
  )
);

it.effect('isolates settings between owners', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'jina',
        jinaKey: Option.some(Redacted.make('alice-secret')),
      });
      yield* settings.update(other, {
        provider: 'browser',
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.none(),
      });
      expect(plainSettings(yield* settings.get(other))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.none(),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });
      expect((yield* settings.get(other)).jinaKey).toEqual(Option.none());

      yield* settings.update(owner, { jinaKey: Option.none() });
      expect(plainSettings(yield* settings.get(other))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.none(),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      });
    })
  )
);

it.effect('stores retention on the same row without clobbering fields', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        provider: 'browser',
        jinaKey: Option.some(Redacted.make('alice-secret')),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
      yield* settings.update(owner, { retention: retention(42) });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: retention(42),
        provider: 'browser',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
      expect((yield* selectRow(owner))?.retention).toBe(42);
      expect(plainSettings(yield* settings.get(other))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.none(),
        browserEndpoint: Option.none(),
      });

      yield* settings.update(owner, { provider: 'jina' });
      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: retention(42),
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.some(browserEndpoint('ws://127.0.0.1:9222')),
      });
    })
  )
);

it.effect('reports unreadable rows as repository failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { provider: 'jina' });
      yield* corruptField(owner, 'provider');

      const error = yield* Effect.flip(settings.get(owner));
      expect(error._tag).toBe('SettingsRepositoryError');
    })
  )
);

it.effect('reports a zero retention as a repository failure', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { provider: 'jina' });
      yield* corruptField(owner, 'retention', 0);

      expect((yield* selectRow(owner))?.retention).toBe(0);
      const error = yield* Effect.flip(settings.get(owner));
      expect(error._tag).toBe('SettingsRepositoryError');
    })
  )
);

it.effect('reports unreadable keys and endpoints as repository failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { provider: 'jina' });
      yield* corruptField(owner, 'jinaKey');

      const keyError = yield* Effect.flip(settings.get(owner));
      expect(keyError._tag).toBe('SettingsRepositoryError');

      yield* corruptField(owner, 'browserEndpoint');
      const settingsError = yield* Effect.flip(settings.get(owner));
      expect(settingsError._tag).toBe('SettingsRepositoryError');
    })
  )
);
