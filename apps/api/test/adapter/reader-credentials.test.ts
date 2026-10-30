import { randomBytes } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { ReaderCredentials } from '@reader/business';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import { ReaderCredentialsLive } from '../../src/adapter/reader-credentials';
import { articlesSchema } from '../../src/infrastructure/articles';
import { CredentialCryptoLive } from '../../src/infrastructure/credential-crypto';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Check = Effect.Effect<void, unknown, ReaderCredentials | Database>;

const makeConfig = () =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      READER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    })
  );

const runWithCredentials = (check: Check) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'credentials-test',
        database: 'credentials',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(articlesSchema)).pipe(
        Effect.andThen(check),
        Effect.provide(
          Layer.mergeAll(
            ReaderCredentialsLive.pipe(
              Layer.provide(CredentialCryptoLive),
              Layer.provide(Layer.succeed(Database, db)),
              Layer.provide(makeConfig())
            ),
            Layer.succeed(Database, db)
          )
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

const selectCiphertext = (owner: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [rows] = yield* Effect.promise(() =>
      db.query<[{ encrypted: string }[]]>(
        'SELECT encrypted FROM reader_credential WHERE owner = $owner;',
        { owner }
      )
    );

    return rows[0]?.encrypted;
  });

const expectCiphertextHidesPlaintext = (ciphertext: string | undefined) => {
  expect(ciphertext).toBeDefined();
  expect(ciphertext).not.toContain('alice-secret');
};

const expectStoredSecret = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  const stored = yield* credentials.get('alice');
  expect(stored).toBeDefined();
  if (stored) {
    expect(Redacted.value(stored)).toBe('alice-secret');
  }

  expectCiphertextHidesPlaintext(yield* selectCiphertext('alice'));
});

const expectOwnerIsolation = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  expect(yield* credentials.configured('bob')).toBe(false);
  expect(yield* credentials.get('bob')).toBeUndefined();
});

const expectUnknownOwner = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  expect(yield* credentials.configured('nobody')).toBe(false);
  expect(yield* credentials.get('nobody')).toBeUndefined();
});

const expectRoundtrip = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  expect(yield* credentials.configured('alice')).toBe(true);
  yield* expectStoredSecret;
  yield* expectOwnerIsolation;
  yield* credentials.remove('alice');
  expect(yield* credentials.configured('alice')).toBe(false);
  expect(yield* credentials.get('alice')).toBeUndefined();
});

it.effect('reports unknown owners as unconfigured', () =>
  runWithCredentials(expectUnknownOwner)
);

it.effect('roundtrips encrypted credentials with owner isolation', () =>
  runWithCredentials(expectRoundtrip)
);
