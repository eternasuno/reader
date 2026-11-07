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

const optionalEndpoint = Schema.decodeSync(
  Schema.OptionFromOptional(BrowserEndpoint)
);

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
  retention: value.feed.retention,
  provider: value.fetcher.provider,
  jinaKey: Option.map(value.fetcher.jina.key, (key) => Redacted.value(key)),
  browserEndpoint: value.fetcher.browser.endpoint,
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

const unsetField = (ownerId: OwnerId, field: 'provider' | 'browserEndpoint') =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(`UPDATE setting SET ${field} = NONE WHERE owner = $owner;`, {
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

const optionalKey = (key?: string) =>
  key === undefined ? Option.none() : Option.some(Redacted.make(key));

const browserFetcher = (key?: string) => ({
  provider: 'browser' as const,
  jina: { key: optionalKey(key) },
  browser: { endpoint: optionalEndpoint('http://127.0.0.1:9222') },
});

const jinaFetcher = (key?: string, endpoint?: string) => ({
  provider: 'jina' as const,
  jina: { key: optionalKey(key) },
  browser: { endpoint: optionalEndpoint(endpoint) },
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

it.effect('saves the fetcher and retention in one row', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        feed: { retention: retention(60) },
        fetcher: browserFetcher('alice-secret'),
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: retention(60),
        provider: 'browser',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });
      const row = yield* selectRow(owner);
      expect(row?.jinaKey).toBe('alice-secret');
      expect(row?.provider).toBe('browser');
      expect(row?.browserEndpoint).toBe('http://127.0.0.1:9222/');
      expect(row?.retention).toBe(60);
    })
  )
);

it.effect('trims stored browser endpoints while loading', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { fetcher: browserFetcher() });
      yield* setStoredEndpoint(owner, '  ws://127.0.0.1:9222  ');

      expect((yield* settings.get(owner)).fetcher.browser.endpoint).toEqual(
        Option.some(browserEndpoint('ws://127.0.0.1:9222'))
      );
    })
  )
);

it.effect('defaults legacy rows without a provider to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { fetcher: jinaFetcher('alice-secret') });
      yield* unsetField(owner, 'provider');

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

it.effect('keeps a browser provider row that has no endpoint', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        fetcher: browserFetcher('alice-secret'),
      });
      yield* unsetField(owner, 'browserEndpoint');

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: Option.none(),
      });
    })
  )
);

it.effect('keeps the fetcher when only retention changes', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        fetcher: browserFetcher('alice-secret'),
      });
      yield* settings.update(owner, { feed: { retention: retention(42) } });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: retention(42),
        provider: 'browser',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });
      expect((yield* selectRow(owner))?.retention).toBe(42);
    })
  )
);

it.effect('clears the key and endpoint stored for a jina fetcher', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        fetcher: jinaFetcher('alice-secret', 'ws://127.0.0.1:9222'),
      });
      yield* settings.update(owner, { fetcher: jinaFetcher() });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.none(),
        browserEndpoint: Option.none(),
      });
      const row = yield* selectRow(owner);
      expect(row?.jinaKey).toBeUndefined();
      expect(row?.browserEndpoint).toBeUndefined();
      expect(row?.provider).toBe('jina');
    })
  )
);

it.effect('stores the endpoint kept by a jina fetcher', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        fetcher: browserFetcher('alice-secret'),
      });
      yield* settings.update(owner, {
        fetcher: jinaFetcher('alice-secret', 'ws://127.0.0.1:9222'),
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: optionalEndpoint('ws://127.0.0.1:9222'),
      });
      expect((yield* selectRow(owner))?.browserEndpoint).toBe(
        'ws://127.0.0.1:9222/'
      );
    })
  )
);

it.effect('isolates settings between owners', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { fetcher: jinaFetcher('alice-secret') });
      yield* settings.update(other, { fetcher: browserFetcher() });

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
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });
      expect((yield* settings.get(other)).fetcher.jina.key).toEqual(
        Option.none()
      );

      yield* settings.update(owner, { fetcher: jinaFetcher() });
      expect(plainSettings(yield* settings.get(other))).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKey: Option.none(),
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });
    })
  )
);

it.effect('reports unreadable rows as repository failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, { fetcher: jinaFetcher() });
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

      yield* settings.update(owner, { fetcher: jinaFetcher() });
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

      yield* settings.update(owner, { fetcher: jinaFetcher() });
      yield* corruptField(owner, 'jinaKey');

      const keyError = yield* Effect.flip(settings.get(owner));
      expect(keyError._tag).toBe('SettingsRepositoryError');

      yield* corruptField(owner, 'browserEndpoint');
      const settingsError = yield* Effect.flip(settings.get(owner));
      expect(settingsError._tag).toBe('SettingsRepositoryError');
    })
  )
);

it.effect('patches the provider, key, and endpoint independently', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;

      yield* settings.update(owner, {
        fetcher: browserFetcher('alice-secret'),
      });
      yield* settings.update(owner, { fetcher: { provider: 'jina' } });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.some('alice-secret'),
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });

      yield* settings.update(owner, {
        fetcher: { jina: { key: Option.none() } },
      });

      expect(plainSettings(yield* settings.get(owner))).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKey: Option.none(),
        browserEndpoint: optionalEndpoint('http://127.0.0.1:9222'),
      });

      yield* settings.update(owner, {
        fetcher: { browser: { endpoint: Option.none() } },
      });

      expect((yield* selectRow(owner))?.browserEndpoint).toBeUndefined();
    })
  )
);
