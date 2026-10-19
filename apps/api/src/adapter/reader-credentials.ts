import { createHash } from 'node:crypto';
import { ArticleFailure, ReaderCredentials } from '@reader/business';
import { Effect, Layer, Redacted } from 'effect';
import type { Surreal } from 'surrealdb';
import { CredentialCrypto } from '../infrastructure/credential-crypto';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

type Crypto = {
  readonly encrypt: (owner: string, value: string) => string;
  readonly decrypt: (owner: string, value: string) => string;
};

type StoredRow = {
  readonly encrypted: string;
};

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
    catch: () => new ArticleFailure({ error: '无法访问 Key 设置' }),
  }).pipe(Effect.map(([result]) => result));

const selectRows = (db: Surreal, owner: string) =>
  runQuery<StoredRow[]>(
    db,
    'SELECT encrypted FROM reader_credential WHERE owner = $owner;',
    owner
  );

const decryptStored = (crypto: Crypto, owner: string, encrypted: string) =>
  Effect.try({
    try: () => Redacted.make(crypto.decrypt(owner, encrypted)),
    catch: () =>
      new ArticleFailure({
        error: '无法解密 Key，请检查服务器加密配置或重新填写',
      }),
  });

const loadKey = (db: Surreal, crypto: Crypto, owner: string) =>
  Effect.gen(function* () {
    const item = (yield* selectRows(db, owner))[0];
    if (!item) {
      return undefined;
    }

    return yield* decryptStored(crypto, owner, item.encrypted);
  });

const encryptKey = (
  crypto: Crypto,
  owner: string,
  key: Redacted.Redacted<string>
) =>
  Effect.try({
    try: () => crypto.encrypt(owner, Redacted.value(key)),
    catch: () =>
      new ArticleFailure({
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

const removeKeys = (db: Surreal, owner: string) =>
  runQuery<unknown[]>(
    db,
    'DELETE reader_credential WHERE owner = $owner;',
    owner
  ).pipe(Effect.asVoid);

const makeCredentials = (db: Surreal, crypto: Crypto) =>
  ReaderCredentials.of({
    configured: (owner) =>
      selectRows(db, owner).pipe(Effect.map((items) => items.length > 0)),
    get: (owner) => loadKey(db, crypto, owner),
    set: (owner, key) => storeKey(db, crypto, owner, key),
    remove: (owner) => removeKeys(db, owner),
  });

export const ReaderCredentialsLive = Layer.effect(
  ReaderCredentials,
  Effect.gen(function* () {
    const db = yield* Database;
    const crypto = yield* CredentialCrypto;

    return makeCredentials(db, crypto);
  })
);
