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

const runWithCredentials = (check: Check, config = makeConfig()) =>
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
              Layer.provide(config)
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

const selectRow = (owner: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [rows] = yield* Effect.promise(() =>
      db.query<
        [{ encrypted?: string; provider?: string; browserEndpoint?: string }[]]
      >(
        'SELECT encrypted, provider, browserEndpoint FROM reader_credential WHERE owner = $owner;',
        { owner }
      )
    );

    return rows[0];
  });

const unsetProvider = (owner: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* Effect.promise(() =>
      db.query(
        'UPDATE reader_credential SET provider = NONE WHERE owner = $owner;',
        { owner }
      )
    );
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
  expect(yield* credentials.provider('bob')).toBe('jina');
  expect(yield* credentials.browserEndpoint('bob')).toBeUndefined();
});

const expectUnknownOwner = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  expect(yield* credentials.configured('nobody')).toBe(false);
  expect(yield* credentials.get('nobody')).toBeUndefined();
  expect(yield* credentials.provider('nobody')).toBe('jina');
  expect(yield* credentials.browserEndpoint('nobody')).toBeUndefined();
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

const expectProviderPersistence = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setProvider('alice', 'browser');

  expect(yield* credentials.provider('alice')).toBe('browser');
  expect((yield* selectRow('alice'))?.provider).toBe('browser');
  expect(yield* credentials.configured('alice')).toBe(false);
  expect(yield* credentials.get('alice')).toBeUndefined();
});

const expectKeySurvivesProviderSwitch = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  yield* credentials.setProvider('alice', 'browser');

  const stored = yield* credentials.get('alice');
  expect(stored).toBeDefined();
  if (stored) {
    expect(Redacted.value(stored)).toBe('alice-secret');
  }

  expect(yield* credentials.provider('alice')).toBe('browser');
  expectCiphertextHidesPlaintext(yield* selectCiphertext('alice'));

  yield* credentials.setProvider('alice', 'jina');
  const restored = yield* credentials.get('alice');
  expect(restored).toBeDefined();
  if (restored) {
    expect(Redacted.value(restored)).toBe('alice-secret');
  }

  expect(yield* credentials.provider('alice')).toBe('jina');
});

const expectLegacyRowDefaultsToJina = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  yield* unsetProvider('alice');

  expect((yield* selectRow('alice'))?.provider).toBeUndefined();
  expect(yield* credentials.provider('alice')).toBe('jina');
  expect(yield* credentials.configured('alice')).toBe(true);
  expectCiphertextHidesPlaintext(yield* selectCiphertext('alice'));
});

const expectRemovalKeepsProvider = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  yield* credentials.setProvider('alice', 'browser');
  yield* credentials.remove('alice');

  expect(yield* credentials.configured('alice')).toBe(false);
  expect(yield* credentials.get('alice')).toBeUndefined();
  expect(yield* credentials.provider('alice')).toBe('browser');
  expect((yield* selectRow('alice'))?.provider).toBe('browser');
});

const expectProviderIsolation = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setProvider('alice', 'browser');
  yield* credentials.setProvider('bob', 'jina');

  expect(yield* credentials.provider('alice')).toBe('browser');
  expect(yield* credentials.provider('bob')).toBe('jina');
  expect(yield* credentials.configured('bob')).toBe(false);
});

const corruptRow = (
  owner: string,
  field: 'encrypted' | 'provider' | 'browserEndpoint'
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const value = field === 'browserEndpoint' ? '1' : '"corrupt"';
    yield* Effect.promise(() =>
      db.query(
        `UPDATE reader_credential SET ${field} = ${value} WHERE owner = $owner;`,
        { owner }
      )
    );
  });

const expectUndecodableCiphertextFailure = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  yield* corruptRow('alice', 'encrypted');

  const error = yield* Effect.flip(credentials.get('alice'));
  expect(error._tag).toBe('ReaderCredentialsError');
  expect(error.error).toBe('无法解密 Key，请检查服务器加密配置或重新填写');
});

const expectUnreadableRowFailure = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setProvider('alice', 'browser');
  yield* corruptRow('alice', 'provider');

  const error = yield* Effect.flip(credentials.provider('alice'));
  expect(error._tag).toBe('ReaderCredentialsError');
  expect(error.error).toBe('无法读取 Key 设置');
});

const expectMissingEncryptionKeyFailure = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  const error = yield* Effect.flip(
    credentials.set('alice', Redacted.make('alice-secret'))
  );
  expect(error._tag).toBe('ReaderCredentialsError');
  expect(error.error).toBe('服务器尚未正确配置 READER_ENCRYPTION_KEY');
});

it.effect('reports undecryptable stored keys as credential failures', () =>
  runWithCredentials(expectUndecodableCiphertextFailure)
);

it.effect('reports unreadable credential rows as credential failures', () =>
  runWithCredentials(expectUnreadableRowFailure)
);

it.effect('reports a missing encryption key as a credential failure', () =>
  runWithCredentials(
    expectMissingEncryptionKeyFailure,
    ConfigProvider.layer(ConfigProvider.fromUnknown({}))
  )
);

it.effect('reports unknown owners as unconfigured', () =>
  runWithCredentials(expectUnknownOwner)
);

it.effect('roundtrips encrypted credentials with owner isolation', () =>
  runWithCredentials(expectRoundtrip)
);

it.effect('persists the selected provider without storing a key', () =>
  runWithCredentials(expectProviderPersistence)
);

it.effect('keeps the encrypted key when switching providers', () =>
  runWithCredentials(expectKeySurvivesProviderSwitch)
);

it.effect('defaults legacy rows without a provider to jina', () =>
  runWithCredentials(expectLegacyRowDefaultsToJina)
);

it.effect('removes the key but retains the selected provider', () =>
  runWithCredentials(expectRemovalKeepsProvider)
);

it.effect('isolates provider selection between owners', () =>
  runWithCredentials(expectProviderIsolation)
);

const expectBrowserEndpointPersistence = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setBrowserEndpoint('alice', 'http://127.0.0.1:9222');

  expect(yield* credentials.browserEndpoint('alice')).toBe(
    'http://127.0.0.1:9222'
  );
  expect((yield* selectRow('alice'))?.browserEndpoint).toBe(
    'http://127.0.0.1:9222'
  );
  expect(yield* credentials.browserEndpoint('bob')).toBeUndefined();
});

const expectBrowserEndpointClearKeepsCredentials = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.set('alice', Redacted.make('alice-secret'));
  yield* credentials.setProvider('alice', 'browser');
  yield* credentials.setBrowserEndpoint('alice', 'ws://127.0.0.1:9222');
  yield* credentials.setBrowserEndpoint('alice', '');

  expect(yield* credentials.browserEndpoint('alice')).toBeUndefined();
  expect((yield* selectRow('alice'))?.browserEndpoint).toBeUndefined();
  expect(yield* credentials.provider('alice')).toBe('browser');
  expect(yield* credentials.configured('alice')).toBe(true);
});

const expectUnreadableEndpointFailure = Effect.gen(function* () {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setBrowserEndpoint('alice', 'http://127.0.0.1:9222');
  yield* corruptRow('alice', 'browserEndpoint');

  const error = yield* Effect.flip(credentials.browserEndpoint('alice'));
  expect(error._tag).toBe('ReaderCredentialsError');
  expect(error.error).toBe('无法读取 Key 设置');
});

it.effect('persists the browser endpoint per owner', () =>
  runWithCredentials(expectBrowserEndpointPersistence)
);

it.effect('clears the browser endpoint without removing credentials', () =>
  runWithCredentials(expectBrowserEndpointClearKeepsCredentials)
);

it.effect('reports unreadable browser endpoints as credential failures', () =>
  runWithCredentials(expectUnreadableEndpointFailure)
);
