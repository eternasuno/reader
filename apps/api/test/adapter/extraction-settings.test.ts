// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one settings boundary.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { ReaderCredentials } from '@reader/business';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import type { Surreal } from 'surrealdb';
import { OwnerId } from '../../../../packages/business/src/entity/model.ts';
import { ExtractionSettings } from '../../../../packages/business/src/port/extraction-settings.ts';
import { ExtractionSettingsLive } from '../../src/adapter/extraction-settings';
import { ReaderCredentialsLive } from '../../src/adapter/reader-credentials';
import { readerStoreSchema } from '../../src/adapter/reader-store';
import { CredentialCryptoLive } from '../../src/infrastructure/credential-crypto';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Services = ExtractionSettings | ReaderCredentials | Database;

const owner = OwnerId.make('alice');
const other = OwnerId.make('bob');

const makeConfig = () =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      READER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    })
  );

const settingsLive = (db: Surreal, config: Layer.Layer<never>) =>
  ExtractionSettingsLive.pipe(
    Layer.provide(CredentialCryptoLive),
    Layer.provide(Layer.succeed(Database, db)),
    Layer.provide(config)
  );

const credentialsLive = (db: Surreal, config: Layer.Layer<never>) =>
  ReaderCredentialsLive.pipe(
    Layer.provide(CredentialCryptoLive),
    Layer.provide(Layer.succeed(Database, db)),
    Layer.provide(config)
  );

const runWithSettings = <A, E>(
  check: Effect.Effect<A, E, Services>,
  config = makeConfig()
) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `extraction-settings-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(check),
        Effect.provide(
          Layer.mergeAll(
            settingsLive(db, config),
            credentialsLive(db, config),
            Layer.succeed(Database, db)
          )
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

const selectRow = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [rows] = yield* Effect.promise(() =>
      db.query<
        [{ encrypted?: string; provider?: string; browserEndpoint?: string }[]]
      >(
        'SELECT encrypted, provider, browserEndpoint FROM reader_credential WHERE owner = $owner;',
        { owner: ownerId }
      )
    );

    return rows[0];
  });

const corruptProvider = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(
        'UPDATE reader_credential SET provider = 1 WHERE owner = $owner;',
        { owner: ownerId }
      )
    );
  });

it.effect('defaults unknown owners to anonymous jina settings', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;

      expect(yield* settings.get(owner)).toEqual({
        provider: 'jina',
        jinaConfigured: false,
        browserEndpoint: '',
      });
    })
  )
);

it.effect('saves provider, key, and endpoint in one row', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: '  http://127.0.0.1:9222  ',
      });

      expect(yield* settings.get(owner)).toEqual({
        provider: 'browser',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      const row = yield* selectRow(owner);
      expect(row?.encrypted).toBeDefined();
      expect(row?.encrypted).not.toContain('alice-secret');
      expect(row?.provider).toBe('browser');
      expect(row?.browserEndpoint).toBe('http://127.0.0.1:9222');
    })
  )
);

it.effect('remains readable through ReaderCredentials', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });

      const stored = yield* credentials.get(owner);
      expect(stored).toBeDefined();
      if (stored) {
        expect(Redacted.value(stored)).toBe('alice-secret');
      }
      expect(yield* credentials.provider(owner)).toBe('browser');
      expect(yield* credentials.browserEndpoint(owner)).toBe(
        'ws://127.0.0.1:9222'
      );
    })
  )
);

it.effect('preserves unspecified fields when patching', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('secret'),
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      yield* settings.save(owner, { provider: 'browser' });

      expect(yield* settings.get(owner)).toEqual({
        provider: 'browser',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('next'),
      });

      expect(yield* settings.get(owner)).toEqual({
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      const stored = yield* credentials.get(owner);
      if (stored) {
        expect(Redacted.value(stored)).toBe('next');
      }
    })
  )
);

it.effect('clears the key without changing provider or endpoint', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* settings.clearKey(owner);

      expect(yield* settings.get(owner)).toEqual({
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      expect(yield* credentials.get(owner)).toBeUndefined();
      expect(yield* credentials.provider(owner)).toBe('browser');
    })
  )
);

it.effect('clears the browser endpoint and resets browser to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'browser',
        key: Redacted.make('alice-secret'),
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* settings.clearBrowser(owner);

      expect(yield* settings.get(owner)).toEqual({
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });
      expect(yield* credentials.provider(owner)).toBe('jina');
      expect(yield* credentials.browserEndpoint(owner)).toBeUndefined();
      expect(yield* credentials.configured(owner)).toBe(true);

      yield* settings.save(owner, {
        provider: 'jina',
        browserEndpoint: 'http://127.0.0.1:9222',
      });
      yield* settings.clearBrowser(owner);
      expect(yield* settings.get(owner)).toEqual({
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
      const settings = yield* ExtractionSettings;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });
      yield* settings.save(other, {
        provider: 'browser',
        browserEndpoint: 'http://127.0.0.1:9222',
      });

      expect(yield* settings.get(owner)).toEqual({
        provider: 'jina',
        jinaConfigured: true,
        browserEndpoint: '',
      });
      expect(yield* settings.get(other)).toEqual({
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'http://127.0.0.1:9222',
      });

      yield* settings.clearKey(owner);
      expect(yield* settings.get(other)).toEqual({
        provider: 'browser',
        jinaConfigured: false,
        browserEndpoint: 'http://127.0.0.1:9222',
      });
    })
  )
);

it.effect('reports unreadable rows as read failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;

      yield* settings.save(owner, { provider: 'jina' });
      yield* corruptProvider(owner);

      const error = yield* Effect.flip(settings.get(owner));
      expect(error._tag).toBe('ExtractionSettingsReadError');
    })
  )
);

it.effect('reports a missing encryption key as a save failure', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;

      const error = yield* Effect.flip(
        settings.save(owner, {
          provider: 'jina',
          key: Redacted.make('alice-secret'),
        })
      );
      expect(error._tag).toBe('ExtractionSettingsWriteError');
      expect(error.error).toBe(
        'READER_ENCRYPTION_KEY is not configured correctly on the server'
      );
      expect(yield* settings.get(owner)).toEqual({
        provider: 'jina',
        jinaConfigured: false,
        browserEndpoint: '',
      });
    }),
    ConfigProvider.layer(ConfigProvider.fromUnknown({}))
  )
);
