import { createHash } from 'node:crypto';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import type { OwnerId } from '../../../../packages/business/src/entity/object-value.ts';
import {
  DEFAULT_RETENTION,
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
    message: 'Failed to access extraction settings',
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

const toJinaKey = (stored: Option.Option<string>) =>
  Option.map(
    Option.filter(stored, (key) => key !== ''),
    (key) => Redacted.make(key)
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
      const storedKey = Option.flatMap(row, (value) => value.jinaKey);
      const endpoint = Option.map(
        Option.flatMap(row, (value) => value.browserEndpoint),
        (value) => value.trim()
      );

      return {
        retention: Option.getOrElse(
          Option.flatMap(row, (value) => value.retention),
          () => DEFAULT_RETENTION
        ),
        provider: Option.getOrElse(
          Option.flatMap(row, (value) => value.provider),
          () => 'jina' as const
        ),
        jinaKey: toJinaKey(storedKey),
        browserEndpoint: Option.filter(endpoint, (value) => value !== ''),
      };
    })
  );

type SaveBindings = {
  provider?: ReaderProvider;
  jinaKey?: string;
  browserEndpoint?: string;
  retention?: number;
};

const saveSql = (settingsPatch: Port.SettingsPatch) => {
  const clauses = ['owner = $owner'];
  const bindings: SaveBindings = {};

  if (settingsPatch.provider !== undefined) {
    clauses.push('provider = $provider');
    bindings.provider = settingsPatch.provider;
  }

  if (settingsPatch.jinaKey !== undefined) {
    Option.match(
      Option.map(settingsPatch.jinaKey, (key) => Redacted.value(key)),
      {
        onNone: () => clauses.push('jinaKey = NONE'),
        onSome: (key) => {
          clauses.push('jinaKey = $jinaKey');
          bindings.jinaKey = key;
        },
      }
    );
  }

  if (settingsPatch.browserEndpoint !== undefined) {
    const endpoint = Option.filter(
      Option.map(settingsPatch.browserEndpoint, (value) => value.trim()),
      (value) => value !== ''
    );

    Option.match(endpoint, {
      onNone: () => clauses.push('browserEndpoint = NONE'),
      onSome: (value) => {
        clauses.push('browserEndpoint = $browserEndpoint');
        bindings.browserEndpoint = value;
      },
    });
  }

  if (settingsPatch.retention !== undefined) {
    clauses.push('retention = $retention');
    bindings.retention = settingsPatch.retention;
  }

  return {
    sql: `UPSERT type::record("setting", $id) SET ${clauses.join(', ')};`,
    bindings,
  };
};

const update = (
  db: Surreal,
  owner: OwnerId,
  settingsPatch: Port.SettingsPatch
) => {
  if (
    settingsPatch.provider === undefined &&
    settingsPatch.jinaKey === undefined &&
    settingsPatch.browserEndpoint === undefined &&
    settingsPatch.retention === undefined
  ) {
    return Effect.void;
  }

  const statement = saveSql(settingsPatch);

  return query<unknown, Port.SettingsRepositoryError>(
    db,
    statement.sql,
    owner,
    statement.bindings,
    repositoryError
  ).pipe(Effect.asVoid);
};

const makeSettings = (db: Surreal) =>
  Port.SettingsRepository.of({
    get: (owner) => load(db, owner),
    update: (owner, settingsPatch) => update(db, owner, settingsPatch),
  });

export const SettingsRepositoryLive = Layer.effect(
  Port.SettingsRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return makeSettings(db);
  })
);
