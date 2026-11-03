import { createHash } from 'node:crypto';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import type { OwnerId } from '../../../../packages/business/src/entity/object-value.ts';
import {
  ReaderProvider,
  Setting,
} from '../../../../packages/business/src/entity/setting.ts';
import * as Port from '../../../../packages/business/src/port/settings-repository.ts';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

const StoredRow = Schema.Struct({
  jinaKey: Schema.OptionFromOptional(Schema.String),
  provider: Schema.OptionFromOptional(ReaderProvider),
  browserEndpoint: Schema.OptionFromOptional(Schema.String),
  retention: Schema.OptionFromOptional(Setting.fields.retention),
});

const ownerHash = (owner: OwnerId) =>
  createHash('sha256').update(owner).digest('hex');

const repositoryError = () =>
  new Port.SettingsRepositoryError({
    error: 'Failed to access extraction settings',
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
    Effect.mapError(repositoryError)
  );

const load = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryError>(
    db,
    'SELECT jinaKey, provider, browserEndpoint, retention FROM setting WHERE owner = $owner;',
    owner,
    {},
    repositoryError
  ).pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows): Port.SettingsRepositoryValue => {
      const row = Option.fromUndefinedOr(rows[0]);
      const browserEndpoint = Option.map(
        Option.flatMap(row, (value) => value.browserEndpoint),
        (value) => value.trim()
      );

      return {
        retention: Option.getOrElse(
          Option.flatMap(row, (value) => value.retention),
          () => Port.DEFAULT_RETENTION
        ),
        provider: Option.getOrElse(
          Option.flatMap(row, (value) => value.provider),
          () => 'jina' as const
        ),
        jinaConfigured: Option.match(
          Option.flatMap(row, (value) => value.jinaKey),
          { onNone: () => false, onSome: (key) => key !== '' }
        ),
        browserEndpoint: Option.filter(
          browserEndpoint,
          (value) => value !== ''
        ),
      };
    })
  );

const loadKey = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryError>(
    db,
    'SELECT jinaKey FROM setting WHERE owner = $owner;',
    owner,
    {},
    repositoryError
  ).pipe(
    Effect.flatMap(decodeRows),
    Effect.map((rows) =>
      Option.map(
        Option.flatMap(Option.fromUndefinedOr(rows[0]), (row) => row.jinaKey),
        (jinaKey) => Redacted.make(jinaKey)
      )
    )
  );

type SaveBindings = {
  provider: ReaderProvider;
  jinaKey?: string;
  browserEndpoint?: string;
};

const saveSql = (
  update: Port.SettingsRepositoryUpdate,
  jinaKey: Option.Option<string>
) => {
  const clauses = ['owner = $owner', 'provider = $provider'];
  const bindings: SaveBindings = { provider: update.provider };

  Option.match(jinaKey, {
    onNone: () => undefined,
    onSome: (key) => {
      clauses.push('jinaKey = $jinaKey');
      bindings.jinaKey = key;
    },
  });

  Option.match(
    Option.map(update.browserEndpoint, (value) => value.trim()),
    {
      onNone: () => undefined,
      onSome: (endpoint) => {
        if (endpoint === '') {
          clauses.push('browserEndpoint = NONE');
        } else {
          clauses.push('browserEndpoint = $browserEndpoint');
          bindings.browserEndpoint = endpoint;
        }
      },
    }
  );

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
    const jinaKey = Option.map(update.key, (key) => Redacted.value(key));
    const statement = saveSql(update, jinaKey);
    yield* query<unknown, Port.SettingsRepositoryError>(
      db,
      statement.sql,
      owner,
      statement.bindings,
      repositoryError
    ).pipe(Effect.asVoid);
  });

const setRetention = (db: Surreal, owner: OwnerId, retention: number) =>
  query<unknown, Port.SettingsRepositoryError>(
    db,
    `UPSERT type::record("setting", $id) SET owner = $owner, retention = $retention;`,
    owner,
    { retention },
    repositoryError
  ).pipe(Effect.asVoid);

const clearKey = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryError>(
    db,
    'UPDATE setting SET jinaKey = NONE WHERE owner = $owner;',
    owner,
    {},
    repositoryError
  ).pipe(Effect.asVoid);

const clearBrowser = (db: Surreal, owner: OwnerId) =>
  query<unknown, Port.SettingsRepositoryError>(
    db,
    'BEGIN TRANSACTION; UPDATE setting SET browserEndpoint = NONE WHERE owner = $owner; UPDATE setting SET provider = "jina" WHERE owner = $owner AND provider = "browser"; COMMIT TRANSACTION;',
    owner,
    {},
    repositoryError
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
