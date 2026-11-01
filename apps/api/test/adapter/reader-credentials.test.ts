import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import {
  ExtractionSettings,
  OwnerId,
  ReaderCredentials,
} from '@reader/business';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import type { Surreal } from 'surrealdb';
import { ExtractionSettingsLive } from '../../src/adapter/extraction-settings';
import { ReaderCredentialsLive } from '../../src/adapter/reader-credentials';
import { readerStoreSchema } from '../../src/adapter/reader-store';
import { CredentialCryptoLive } from '../../src/infrastructure/credential-crypto';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Check = Effect.Effect<
  void,
  unknown,
  ExtractionSettings | ReaderCredentials | Database
>;

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
    Layer.provide(Layer.fresh(CredentialCryptoLive)),
    Layer.provide(Layer.succeed(Database, db)),
    Layer.provide(config)
  );

const credentialsLive = (db: Surreal, config: Layer.Layer<never>) =>
  ReaderCredentialsLive.pipe(
    Layer.provide(Layer.fresh(CredentialCryptoLive)),
    Layer.provide(Layer.succeed(Database, db)),
    Layer.provide(config)
  );

const runWithSettings = (
  check: Check,
  config = makeConfig(),
  readConfig = config
) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `credentials-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(check),
        Effect.provide(
          Layer.mergeAll(
            settingsLive(db, config),
            credentialsLive(db, readConfig),
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

const unsetProvider = (ownerId: OwnerId) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(
        'UPDATE reader_credential SET provider = NONE WHERE owner = $owner;',
        { owner: ownerId }
      )
    );
  });

const corruptField = (
  ownerId: OwnerId,
  field: 'provider' | 'browserEndpoint' | 'encrypted'
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const value = field === 'encrypted' ? 'corrupt' : 1;

    yield* Effect.promise(() =>
      db.query(
        `UPDATE reader_credential SET ${field} = $value WHERE owner = $owner;`,
        { owner: ownerId, value }
      )
    );
  });

it.effect(
  'roundtrips encrypted keys saved through settings with isolation',
  () =>
    runWithSettings(
      Effect.gen(function* () {
        const settings = yield* ExtractionSettings;
        const credentials = yield* ReaderCredentials;

        yield* settings.save(owner, {
          provider: 'jina',
          key: Redacted.make('alice-secret'),
        });

        const stored = yield* credentials.get(owner);
        expect(stored).toBeDefined();
        if (stored) {
          expect(Redacted.value(stored)).toBe('alice-secret');
        }

        const ciphertext = (yield* selectRow(owner))?.encrypted;
        expect(ciphertext).toBeDefined();
        expect(ciphertext).not.toContain('alice-secret');

        expect(yield* credentials.get(other)).toBeUndefined();
        expect(yield* credentials.provider(other)).toBe('jina');
        expect(yield* credentials.browserEndpoint(other)).toBeUndefined();
      })
    )
);

it.effect('defaults legacy rows without a provider to jina', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });
      yield* unsetProvider(owner);

      expect((yield* selectRow(owner))?.provider).toBeUndefined();
      expect(yield* credentials.provider(owner)).toBe('jina');
      expect(yield* credentials.get(owner)).toBeDefined();
    })
  )
);

it.effect('reports a missing encryption key when reading a stored key', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });

      const error = yield* Effect.flip(credentials.get(owner));
      expect(error._tag).toBe('ReaderCredentialsError');
      expect(error.error).toBe(
        'Failed to decrypt key; check the server encryption configuration or re-enter the key'
      );
    }),
    makeConfig(),
    ConfigProvider.layer(ConfigProvider.fromUnknown({}))
  )
);

it.effect('reports unreadable credential rows as credential failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, { provider: 'jina' });
      yield* corruptField(owner, 'provider');

      const error = yield* Effect.flip(credentials.provider(owner));
      expect(error._tag).toBe('ReaderCredentialsError');
      expect(error.error).toBe('Failed to read key settings');
    })
  )
);

it.effect('reports unreadable browser endpoints as credential failures', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'browser',
        browserEndpoint: 'ws://127.0.0.1:9222',
      });
      yield* corruptField(owner, 'browserEndpoint');

      const error = yield* Effect.flip(credentials.browserEndpoint(owner));
      expect(error._tag).toBe('ReaderCredentialsError');
      expect(error.error).toBe('Failed to read key settings');
    })
  )
);

it.effect('reports corrupt stored ciphertext as a credential failure', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'jina',
        key: Redacted.make('alice-secret'),
      });
      yield* corruptField(owner, 'encrypted');

      const error = yield* Effect.flip(credentials.get(owner));
      expect(error._tag).toBe('ReaderCredentialsError');
      expect(error.error).toBe(
        'Failed to decrypt key; check the server encryption configuration or re-enter the key'
      );
    })
  )
);

it.effect('reports unknown owners as unconfigured', () =>
  runWithSettings(
    Effect.gen(function* () {
      const credentials = yield* ReaderCredentials;

      expect(yield* credentials.get(other)).toBeUndefined();
      expect(yield* credentials.provider(other)).toBe('jina');
      expect(yield* credentials.browserEndpoint(other)).toBeUndefined();
    })
  )
);

it.effect('reads the stored browser endpoint per owner', () =>
  runWithSettings(
    Effect.gen(function* () {
      const settings = yield* ExtractionSettings;
      const credentials = yield* ReaderCredentials;

      yield* settings.save(owner, {
        provider: 'browser',
        browserEndpoint: '  http://127.0.0.1:9222  ',
      });

      expect(yield* credentials.browserEndpoint(owner)).toBe(
        'http://127.0.0.1:9222'
      );
      expect(yield* credentials.browserEndpoint(other)).toBeUndefined();
    })
  )
);
