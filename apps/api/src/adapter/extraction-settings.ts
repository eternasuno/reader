import { createHash } from 'node:crypto';
import { Effect, Layer, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { ReaderProvider } from '../../../../packages/business/src/entity/article.ts';
import type { OwnerId } from '../../../../packages/business/src/entity/model.ts';
import * as Port from '../../../../packages/business/src/port/extraction-settings.ts';
import { CredentialCrypto } from '../infrastructure/credential-crypto';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

type Crypto = {
  readonly encrypt: (owner: string, value: string) => string;
};

const StoredRow = Schema.Struct({
  encrypted: Schema.optional(Schema.String),
  provider: Schema.optional(ReaderProvider),
  browserEndpoint: Schema.optional(Schema.String),
});

const ownerHash = (owner: OwnerId) =>
  createHash('sha256').update(owner).digest('hex');

const readError = () =>
  new Port.ExtractionSettingsReadError({
    error: 'Failed to read extraction settings',
  });

const writeError = () =>
  new Port.ExtractionSettingsWriteError({
    error: 'Failed to save extraction settings',
  });

const query = <A, E>(
  db: Surreal,
  sql: string,
  owner: OwnerId,
  extra: Bindings,
  onError: () => E
) =>
  Effect.tryPromise({
    try: () => db.query<[A]>(sql, { owner, id: ownerHash(owner), ...extra }),
    catch: onError,
  }).pipe(Effect.map(([result]) => result));

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(StoredRow))(rows).pipe(
    Effect.mapError(readError)
  );

const load = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.ExtractionSettingsReadError>(
    db,
    'SELECT encrypted, provider, browserEndpoint FROM reader_credential WHERE owner = $owner;',
    owner,
    {},
    readError
  ).pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows): Port.ExtractionSettingsValue => {
      const row = rows[0];

      return {
        provider: row?.provider ?? 'jina',
        jinaConfigured: Boolean(row?.encrypted),
        browserEndpoint: row?.browserEndpoint?.trim() ?? '',
      };
    })
  );

const encryptKey = (
  crypto: Crypto,
  owner: OwnerId,
  key: Redacted.Redacted<string>
) =>
  Effect.try({
    try: () => crypto.encrypt(owner, Redacted.value(key)),
    catch: () =>
      new Port.ExtractionSettingsWriteError({
        error:
          'READER_ENCRYPTION_KEY is not configured correctly on the server',
      }),
  });

type SaveBindings = {
  readonly provider: ReaderProvider;
  readonly encrypted?: string;
  readonly browserEndpoint?: string;
};

const saveSql = (update: Port.ExtractionSettingsUpdate, encrypted?: string) => {
  const clauses = ['owner = $owner', 'provider = $provider'];
  if (encrypted !== undefined) {
    clauses.push('encrypted = $encrypted');
  }

  const endpoint = update.browserEndpoint?.trim();
  if (endpoint === '') {
    clauses.push('browserEndpoint = NONE');
  } else if (endpoint !== undefined) {
    clauses.push('browserEndpoint = $browserEndpoint');
  }

  const bindings: SaveBindings = {
    provider: update.provider,
    ...(encrypted === undefined ? {} : { encrypted }),
    ...(endpoint === undefined || endpoint === ''
      ? {}
      : { browserEndpoint: endpoint }),
  };

  return {
    sql: `UPSERT type::record("reader_credential", $id) SET ${clauses.join(', ')};`,
    bindings,
  };
};

const save = (
  db: Surreal,
  crypto: Crypto,
  owner: OwnerId,
  update: Port.ExtractionSettingsUpdate
) =>
  Effect.gen(function* () {
    let encrypted: string | undefined;
    if (update.key !== undefined) {
      encrypted = yield* encryptKey(crypto, owner, update.key);
    }

    const statement = saveSql(update, encrypted);
    yield* query<unknown, Port.ExtractionSettingsWriteError>(
      db,
      statement.sql,
      owner,
      statement.bindings,
      writeError
    ).pipe(Effect.asVoid);
  });

const clearKey = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.ExtractionSettingsWriteError>(
    db,
    'UPDATE reader_credential SET encrypted = NONE WHERE owner = $owner;',
    owner,
    {},
    writeError
  ).pipe(Effect.asVoid);

const clearBrowser = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.ExtractionSettingsWriteError>(
    db,
    'BEGIN TRANSACTION; UPDATE reader_credential SET browserEndpoint = NONE WHERE owner = $owner; UPDATE reader_credential SET provider = "jina" WHERE owner = $owner AND provider = "browser"; COMMIT TRANSACTION;',
    owner,
    {},
    writeError
  ).pipe(Effect.asVoid);

const makeSettings = (db: Surreal, crypto: Crypto) =>
  Port.ExtractionSettings.of({
    get: (owner) => load(db, owner),
    save: (owner, update) => save(db, crypto, owner, update),
    clearKey: (owner) => clearKey(db, owner),
    clearBrowser: (owner) => clearBrowser(db, owner),
  });

export const ExtractionSettingsLive = Layer.effect(
  Port.ExtractionSettings,
  Effect.gen(function* () {
    const db = yield* Database;
    const crypto = yield* CredentialCrypto;

    return makeSettings(db, crypto);
  })
);
