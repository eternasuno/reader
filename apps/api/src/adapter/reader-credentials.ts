import { createHash } from 'node:crypto';
import {
  ReaderCredentials,
  ReaderCredentialsError,
  ReaderProvider,
} from '@reader/business';
import { Effect, Layer, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { CredentialCrypto } from '../infrastructure/credential-crypto';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

type Crypto = {
  readonly encrypt: (owner: string, value: string) => string;
  readonly decrypt: (owner: string, value: string) => string;
};

const StoredRow = Schema.Struct({
  encrypted: Schema.optional(Schema.String),
  provider: Schema.optional(ReaderProvider),
  browserEndpoint: Schema.optional(Schema.String),
});

const ownerId = (owner: string) =>
  createHash('sha256').update(owner).digest('hex');

const runQuery = <A>(
  db: Surreal,
  sql: string,
  owner: string,
  extra: Bindings = {}
) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, { owner, id: ownerId(owner), ...extra }),
    catch: () => new ReaderCredentialsError({ error: '无法访问 Key 设置' }),
  }).pipe(Effect.map(([result]) => result));

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(StoredRow))(rows).pipe(
    Effect.mapError(
      () => new ReaderCredentialsError({ error: '无法读取 Key 设置' })
    )
  );

const selectRows = (db: Surreal, owner: string) =>
  runQuery<unknown>(
    db,
    'SELECT encrypted, provider, browserEndpoint FROM reader_credential WHERE owner = $owner;',
    owner
  ).pipe(Effect.flatMap(decodeRows));

const loadConfigured = (db: Surreal, owner: string) =>
  selectRows(db, owner).pipe(Effect.map((rows) => Boolean(rows[0]?.encrypted)));

const loadProvider = (db: Surreal, owner: string) =>
  selectRows(db, owner).pipe(Effect.map((rows) => rows[0]?.provider ?? 'jina'));

const loadBrowserEndpoint = (db: Surreal, owner: string) =>
  selectRows(db, owner).pipe(
    Effect.map((rows) => rows[0]?.browserEndpoint?.trim() || undefined)
  );

const decryptStored = (crypto: Crypto, owner: string, encrypted: string) =>
  Effect.try({
    try: () => Redacted.make(crypto.decrypt(owner, encrypted)),
    catch: () =>
      new ReaderCredentialsError({
        error: '无法解密 Key，请检查服务器加密配置或重新填写',
      }),
  });

const loadKey = (db: Surreal, crypto: Crypto, owner: string) =>
  Effect.gen(function* () {
    const encrypted = (yield* selectRows(db, owner))[0]?.encrypted;
    if (!encrypted) {
      return undefined;
    }

    return yield* decryptStored(crypto, owner, encrypted);
  });

const encryptKey = (
  crypto: Crypto,
  owner: string,
  key: Redacted.Redacted<string>
) =>
  Effect.try({
    try: () => crypto.encrypt(owner, Redacted.value(key)),
    catch: () =>
      new ReaderCredentialsError({
        error: '服务器尚未正确配置 READER_ENCRYPTION_KEY',
      }),
  });

const storeKey = (
  db: Surreal,
  crypto: Crypto,
  owner: string,
  key: Redacted.Redacted<string>
) =>
  Effect.gen(function* () {
    const encrypted = yield* encryptKey(crypto, owner, key);
    yield* runQuery(
      db,
      'UPSERT type::record("reader_credential", $id) SET owner = $owner, encrypted = $encrypted;',
      owner,
      { encrypted }
    );
  });

const removeKey = (db: Surreal, owner: string) =>
  runQuery(
    db,
    'UPDATE reader_credential SET encrypted = NONE WHERE owner = $owner;',
    owner
  ).pipe(Effect.asVoid);

const storeProvider = (db: Surreal, owner: string, provider: ReaderProvider) =>
  runQuery(
    db,
    'UPSERT type::record("reader_credential", $id) SET owner = $owner, provider = $provider;',
    owner,
    { provider }
  ).pipe(Effect.asVoid);

const storeBrowserEndpoint = (db: Surreal, owner: string, endpoint: string) => {
  const browserEndpoint = endpoint.trim();

  if (!browserEndpoint) {
    return runQuery(
      db,
      'UPDATE reader_credential SET browserEndpoint = NONE WHERE owner = $owner;',
      owner
    ).pipe(Effect.asVoid);
  }

  return runQuery(
    db,
    'UPSERT type::record("reader_credential", $id) SET owner = $owner, browserEndpoint = $browserEndpoint;',
    owner,
    { browserEndpoint }
  ).pipe(Effect.asVoid);
};

const makeCredentials = (db: Surreal, crypto: Crypto) =>
  ReaderCredentials.of({
    configured: (owner) => loadConfigured(db, owner),
    get: (owner) => loadKey(db, crypto, owner),
    set: (owner, key) => storeKey(db, crypto, owner, key),
    remove: (owner) => removeKey(db, owner),
    provider: (owner) => loadProvider(db, owner),
    setProvider: (owner, provider) => storeProvider(db, owner, provider),
    browserEndpoint: (owner) => loadBrowserEndpoint(db, owner),
    setBrowserEndpoint: (owner, endpoint) =>
      storeBrowserEndpoint(db, owner, endpoint),
  });

export const ReaderCredentialsLive = Layer.effect(
  ReaderCredentials,
  Effect.gen(function* () {
    const db = yield* Database;
    const crypto = yield* CredentialCrypto;

    return makeCredentials(db, crypto);
  })
);
