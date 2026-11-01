import {
  ReaderCredentials,
  ReaderCredentialsError,
  ReaderProvider,
} from '@reader/business';
import { Effect, Layer, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { CredentialCrypto } from '../infrastructure/credential-crypto';
import { Database } from '../infrastructure/db';

type Crypto = {
  readonly decrypt: (owner: string, value: string) => string;
};

const StoredRow = Schema.Struct({
  encrypted: Schema.optional(Schema.String),
  provider: Schema.optional(ReaderProvider),
  browserEndpoint: Schema.optional(Schema.String),
});

const runQuery = <A>(db: Surreal, sql: string, owner: string) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, { owner }),
    catch: () =>
      new ReaderCredentialsError({ error: 'Failed to access key settings' }),
  }).pipe(Effect.map(([result]) => result));

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(StoredRow))(rows).pipe(
    Effect.mapError(
      () => new ReaderCredentialsError({ error: 'Failed to read key settings' })
    )
  );

const selectRows = (db: Surreal, owner: string) =>
  runQuery<unknown>(
    db,
    'SELECT encrypted, provider, browserEndpoint FROM reader_credential WHERE owner = $owner;',
    owner
  ).pipe(Effect.flatMap(decodeRows));

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
        error:
          'Failed to decrypt key; check the server encryption configuration or re-enter the key',
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

const makeCredentials = (db: Surreal, crypto: Crypto) =>
  ReaderCredentials.of({
    get: (owner) => loadKey(db, crypto, owner),
    provider: (owner) => loadProvider(db, owner),
    browserEndpoint: (owner) => loadBrowserEndpoint(db, owner),
  });

export const ReaderCredentialsLive = Layer.effect(
  ReaderCredentials,
  Effect.gen(function* () {
    const db = yield* Database;
    const crypto = yield* CredentialCrypto;

    return makeCredentials(db, crypto);
  })
);
