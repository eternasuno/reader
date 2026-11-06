import { createHash } from 'node:crypto';
import {
  BrowserEndpoint,
  FetcherProvider,
  type FetcherSetting,
  fetcherEndpoint,
  JinaKey,
  OwnerId,
  Retention,
  type Setting,
  type SettingsPatch,
  SettingsRepository,
  SettingsRepositoryError,
} from '@reader/business';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../infrastructure/db';

type Bindings = Record<string, unknown>;

const StoredSetting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: FetcherProvider,
  jinaKey: Schema.OptionFromOptional(JinaKey),
  browserEndpoint: Schema.OptionFromOptional(BrowserEndpoint),
});

const fetcherOf = (stored: typeof StoredSetting.Type): FetcherSetting =>
  stored.provider === 'browser' && Option.isSome(stored.browserEndpoint)
    ? {
        provider: 'browser',
        key: stored.jinaKey,
        endpoint: stored.browserEndpoint.value,
      }
    : {
        provider: 'jina',
        key: stored.jinaKey,
        endpoint: stored.browserEndpoint,
      };

const settingOf = (stored: typeof StoredSetting.Type): Setting => ({
  ownerId: stored.ownerId,
  retention: stored.retention,
  fetcher: fetcherOf(stored),
});

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
    Effect.map(settingOf),
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
  provider?: FetcherProvider;
  jinaKey?: string;
  browserEndpoint?: string;
  retention?: Retention;
};

const saveSql = (settingsPatch: SettingsPatch) => {
  const clauses = ['owner = $owner'];
  const bindings: SaveBindings = {};
  const fetcher = settingsPatch.fetcher;

  if (fetcher !== undefined) {
    clauses.push('provider = $provider');
    bindings.provider = fetcher.provider;

    Option.match(fetcherEndpoint(fetcher), {
      onNone: () => clauses.push('browserEndpoint = NONE'),
      onSome: (value) => {
        clauses.push('browserEndpoint = $browserEndpoint');
        bindings.browserEndpoint = value.href;
      },
    });

    Option.match(fetcher.key, {
      onNone: () => clauses.push('jinaKey = NONE'),
      onSome: (key) => {
        clauses.push('jinaKey = $jinaKey');
        bindings.jinaKey = Redacted.value(key);
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
    settingsPatch.fetcher === undefined &&
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
