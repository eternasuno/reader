import { createHash } from 'node:crypto';
import {
  type BrowserEndpoint,
  DEFAULT_RETENTION,
  type OwnerId,
  type ReaderProvider,
  type Retention,
  Setting,
  type SettingsPatch,
  SettingsRepository,
  SettingsRepositoryError,
} from '@reader/business';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

const StoredSetting = Setting.mapFields((fields) => ({
  ...fields,
  jinaKey: Schema.OptionFromOptional(
    Schema.String.pipe(Schema.decodeTo(Schema.RedactedFromValue(Schema.String)))
  ),
  provider: fields.provider.pipe(
    Schema.withDecodingDefaultType(Effect.succeed<ReaderProvider>('jina'))
  ),
  retention: fields.retention.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_RETENTION))
  ),
}));

const ownerHash = (owner: OwnerId) =>
  createHash('sha256').update(owner).digest('hex');

const repositoryError = () =>
  new SettingsRepositoryError({
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

const decodeRow = (row: unknown) =>
  Schema.decodeUnknownEffect(StoredSetting)(row).pipe(
    Effect.mapError(repositoryError)
  );

const load = (db: Surreal, owner: OwnerId) =>
  query<Array<unknown>, SettingsRepositoryError>(
    db,
    'SELECT owner AS ownerId, jinaKey, provider, browserEndpoint, retention FROM setting WHERE owner = $owner;',
    owner,
    {},
    repositoryError
  ).pipe(Effect.flatMap((rows) => decodeRow(rows[0] ?? { ownerId: owner })));

type SaveBindings = {
  provider?: ReaderProvider;
  jinaKey?: string;
  browserEndpoint?: BrowserEndpoint;
  retention?: Retention;
};

const saveSql = (settingsPatch: SettingsPatch) => {
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
    Option.match(settingsPatch.browserEndpoint, {
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

const update = (db: Surreal, owner: OwnerId, settingsPatch: SettingsPatch) => {
  if (
    settingsPatch.provider === undefined &&
    settingsPatch.jinaKey === undefined &&
    settingsPatch.browserEndpoint === undefined &&
    settingsPatch.retention === undefined
  ) {
    return Effect.void;
  }

  const statement = saveSql(settingsPatch);

  return query<unknown, SettingsRepositoryError>(
    db,
    statement.sql,
    owner,
    statement.bindings,
    repositoryError
  ).pipe(Effect.asVoid);
};

const makeSettings = (db: Surreal) =>
  SettingsRepository.of({
    get: (owner) => load(db, owner),
    update: (owner, settingsPatch) => update(db, owner, settingsPatch),
  });

export const SettingsRepositoryLive = Layer.effect(
  SettingsRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return makeSettings(db);
  })
);
