// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one settings boundary.
import { randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { OwnerId } from '../../../../packages/business/src/entity/object-value.ts';
import { SettingsRepository } from '../../../../packages/business/src/port/settings-repository.ts';
import { readerStoreSchema } from '../../src/adapter/reader-store';
import { SettingsRepositoryLive } from '../../src/adapter/settings-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Services = SettingsRepository | Database;

const owner = Schema.decodeSync(OwnerId)('alice');
const other = Schema.decodeSync(OwnerId)('bob');

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
          {
            id?: string;
            jinaKey?: string;
            provider?: string;
            browserEndpoint?: string;
            retention?: number;
          }[],
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

it.effect('defaults unknown owners to anonymous jina settings', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: false,
        browserEndpoint: '',
      });
      expect(yield* settings.getKey(owner)).toBeUndefined();
    })
  )
);

it.effect('saves provider, key, and endpoint in one row', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: '  http://127.0.0.1:9222  ',
      });

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      const row = yield* selectRow(owner);
      expect(row?.jinaKey).toBe('alice-secret');
      expect(row?.provider).toBe('browser');
      expect(row?.browserEndpoint).toBe('http://127.0.0.1:9222');
      const stored = yield* settings.getKey(owner);
      expect(stored).toBeDefined();
      if (stored) {
        expect(Redacted.value(stored)).toBe('alice-secret');
      }
    })
  )
);

it.effect('defaults legacy rows without a provider to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });
      yield* unsetProvider(owner);

      expect((yield* selectRow(owner))?.provider).toBeUndefined();
      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });
      const stored = yield* settings.getKey(owner);
      if (stored) {
        expect(Redacted.value(stored)).toBe('alice-secret');
      }
    })
  )
);

it.effect('preserves unspecified fields when patching', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('secret'),
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      yield* settings.save(owner, { provider: 'browser' });

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('next'),
      });

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      const stored = yield* settings.getKey(owner);
      if (stored) {
        expect(Redacted.value(stored)).toBe('next');
      }
    })
  )
);

it.effect('clears the key without changing provider or endpoint', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* settings.clearKey(owner);

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      expect(yield* settings.getKey(owner)).toBeUndefined();
    })
  )
);

it.effect('clears the browser endpoint and resets browser to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* settings.clearBrowser(owner);

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });

      yield* settings.save(owner, {
        provider: 'jina',
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      yield* settings.clearBrowser(owner);
      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });

      yield* settings.save(owner, {
        provider: 'jina',
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      yield* settings.save(owner, { provider: 'jina', browserEndpoint: '' });
      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });
    })
  )
);

it.effect('isolates settings between owners', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });
      yield* settings.save(other, {
        provider: 'browser',
        browserEndpoint: 'http://127.0.0.1:9222',
      });

      expect(yield* settings.get(owner)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });
      expect(yield* settings.get(other)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      const stored = yield* settings.getKey(owner);
      if (stored) {
        expect(Redacted.value(stored)).toBe('alice-secret');
      }
      expect(yield* settings.getKey(other)).toBeUndefined();

      yield* settings.clearKey(owner);
      expect(yield* settings.get(other)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
    })
  )
);

it.effect('stores retention on the same row without clobbering fields', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* settings.setRetention(owner, 42);

      expect(yield* settings.get(owner)).toEqual({
        retention: 42,
        provider: 'browser',
        jinaConfigured: true,
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      expect((yield* selectRow(owner))?.retention).toBe(42);
      expect(yield* settings.get(other)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaConfigured: false,
        browserEndpoint: '',
      });

      yield* settings.save(owner, { provider: 'jina' });
      expect(yield* settings.get(owner)).toEqual({
        retention: 42,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
    })
  )
);

it.effect('reports unreadable rows as read failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, { provider: 'jina' });
      yield* corruptField(owner, 'provider');

      const error = yield* Effect.flip(settings.get(owner));
      expect(error._tag).toBe('SettingsRepositoryReadError');
    })
  )
);

it.effect('reports a zero retention as a read failure', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, { provider: 'jina' });
      yield* corruptField(owner, 'retention', 0);

      expect((yield* selectRow(owner))?.retention).toBe(0);
      const error = yield* Effect.flip(settings.get(owner));
      expect(error._tag).toBe('SettingsRepositoryReadError');
    })
  )
);

it.effect('reports unreadable keys and endpoints as read failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* corruptField(owner, 'jinaKey');

      const keyError = yield* Effect.flip(settings.getKey(owner));
      expect(keyError._tag).toBe('SettingsRepositoryReadError');

      yield* corruptField(owner, 'browserEndpoint');
      const settingsError = yield* Effect.flip(settings.get(owner));
      expect(settingsError._tag).toBe('SettingsRepositoryReadError');
    })
  )
);
