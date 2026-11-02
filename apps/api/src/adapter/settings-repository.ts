import { createHash } from 'node:crypto';
import { Effect, Layer, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  type OwnerId,
  ReaderProvider,
} from '../../../../packages/business/src/entity/object-value.ts';
import { Setting } from '../../../../packages/business/src/entity/setting.ts';
import * as Port from '../../../../packages/business/src/port/settings-repository.ts';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

const StoredRow = Schema.Struct({
  jinaKey: Schema.optional(Schema.String),
  provider: Schema.optional(ReaderProvider),
  browserEndpoint: Schema.optional(Schema.String),
  retention: Schema.optional(Setting.fields.retention),
});

const ownerHash = (owner: OwnerId) =>
  createHash('sha256').update(owner).digest('hex');

const readError = () =>
  new Port.SettingsRepositoryReadError({
    error: 'Failed to read extraction settings',
  });

const writeError = () =>
  new Port.SettingsRepositoryWriteError({
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
  query<unknown, Port.SettingsRepositoryReadError>(
    db,
    'SELECT jinaKey, provider, browserEndpoint, retention FROM setting WHERE owner = $owner;',
    owner,
    {},
    readError
  ).pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows): Port.SettingsRepositoryValue => {
      const row = rows[0];

      return {
        retention: row?.retention ?? Port.DEFAULT_RETENTION,
        provider: row?.provider ?? 'jina',
        jinaConfigured: Boolean(row?.jinaKey),
        browserEndpoint: row?.browserEndpoint?.trim() ?? '',
      };
    })
  );

const loadKey = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryReadError>(
    db,
    'SELECT jinaKey FROM setting WHERE owner = $owner;',
    owner,
    {},
    readError
  ).pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows) => {
      const jinaKey = rows[0]?.jinaKey;

      return jinaKey === undefined ? undefined : Redacted.make(jinaKey);
    })
  );

type SaveBindings = {
  readonly provider: ReaderProvider;
  readonly jinaKey?: string;
  readonly browserEndpoint?: string;
};

const saveSql = (update: Port.SettingsRepositoryUpdate, jinaKey?: string) => {
  const clauses = ['owner = $owner', 'provider = $provider'];
  if (jinaKey !== undefined) {
    clauses.push('jinaKey = $jinaKey');
  }

  const endpoint = update.browserEndpoint?.trim();
  if (endpoint === '') {
    clauses.push('browserEndpoint = NONE');
  } else if (endpoint !== undefined) {
    clauses.push('browserEndpoint = $browserEndpoint');
  }

  const bindings: SaveBindings = {
    provider: update.provider,
    ...(jinaKey === undefined ? {} : { jinaKey }),
    ...(endpoint === undefined || endpoint === ''
      ? {}
      : { browserEndpoint: endpoint }),
  };

  return {
    sql: `UPSERT type::record("setting", $id) SET ${clauses.join(', ')};`,
    bindings,
  };
};

const save = (
  db: Surreal,
  owner: OwnerId,
  update: Port.SettingsRepositoryUpdate
) =>
  Effect.gen(function* () {
    const jinaKey =
      update.key === undefined ? undefined : Redacted.value(update.key);
    const statement = saveSql(update, jinaKey);
    yield* query<unknown, Port.SettingsRepositoryWriteError>(
      db,
      statement.sql,
      owner,
      statement.bindings,
      writeError
    ).pipe(Effect.asVoid);
  });

const setRetention = (db: Surreal, owner: OwnerId, retention: number) =>
  query<unknown, Port.SettingsRepositoryWriteError>(
    db,
    `UPSERT type::record("setting", $id) SET owner = $owner, retention = $retention;`,
    owner,
    { retention },
    writeError
  ).pipe(Effect.asVoid);

const clearKey = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryWriteError>(
    db,
    'UPDATE setting SET jinaKey = NONE WHERE owner = $owner;',
    owner,
    {},
    writeError
  ).pipe(Effect.asVoid);

const clearBrowser = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryWriteError>(
    db,
    'BEGIN TRANSACTION; UPDATE setting SET browserEndpoint = NONE WHERE owner = $owner; UPDATE setting SET provider = "jina" WHERE owner = $owner AND provider = "browser"; COMMIT TRANSACTION;',
    owner,
    {},
    writeError
  ).pipe(Effect.asVoid);

const makeSettings = (db: Surreal) =>
  Port.SettingsRepository.of({
    get: (owner) => load(db, owner),
    getKey: (owner) => loadKey(db, owner),
    save: (owner, update) => save(db, owner, update),
    setRetention: (owner, retention) => setRetention(db, owner, retention),
    clearKey: (owner) => clearKey(db, owner),
    clearBrowser: (owner) => clearBrowser(db, owner),
  });

export const SettingsRepositoryLive = Layer.effect(
  Port.SettingsRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return makeSettings(db);
  })
);
