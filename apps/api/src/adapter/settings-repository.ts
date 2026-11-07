import { createHash } from 'node:crypto';
import {
  BrowserEndpoint,
  FetcherProvider,
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

const settingOf = (stored: typeof StoredSetting.Type): Setting => ({
  ownerId: stored.ownerId,
  feed: { retention: stored.retention },
  fetcher: {
    provider: stored.provider,
    jina: { key: stored.jinaKey },
    browser: { endpoint: stored.browserEndpoint },
  },
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

type Assignments = {
  readonly clauses: ReadonlyArray<string>;
  readonly bindings: SaveBindings;
};

const NO_ASSIGNMENTS: Assignments = { clauses: [], bindings: {} };

const optionalAssignment = <A>(
  parameter: 'jinaKey' | 'browserEndpoint',
  value: Option.Option<A>,
  encode: (value: A) => string
): Assignments =>
  Option.match(value, {
    onNone: () => ({ clauses: [`${parameter} = NONE`], bindings: {} }),
    onSome: (some) => ({
      clauses: [`${parameter} = $${parameter}`],
      bindings: { [parameter]: encode(some) },
    }),
  });

const merge = (parts: ReadonlyArray<Assignments>): Assignments => ({
  clauses: parts.flatMap((part) => part.clauses),
  bindings: Object.assign({}, ...parts.map((part) => part.bindings)),
});

const fetcherAssignments = (
  fetcher: NonNullable<SettingsPatch['fetcher']>
): Assignments =>
  merge([
    fetcher.provider === undefined
      ? NO_ASSIGNMENTS
      : {
          clauses: ['provider = $provider'],
          bindings: { provider: fetcher.provider },
        },
    fetcher.jina === undefined
      ? NO_ASSIGNMENTS
      : optionalAssignment('jinaKey', fetcher.jina.key, (key) =>
          Redacted.value(key)
        ),
    fetcher.browser === undefined
      ? NO_ASSIGNMENTS
      : optionalAssignment(
          'browserEndpoint',
          fetcher.browser.endpoint,
          (endpoint) => endpoint.href
        ),
  ]);

const feedAssignments = (
  feed: NonNullable<SettingsPatch['feed']>
): Assignments =>
  feed.retention === undefined
    ? NO_ASSIGNMENTS
    : {
        clauses: ['retention = $retention'],
        bindings: { retention: feed.retention },
      };

const saveSql = (settingsPatch: SettingsPatch) => {
  const { clauses, bindings } = merge([
    settingsPatch.fetcher === undefined
      ? NO_ASSIGNMENTS
      : fetcherAssignments(settingsPatch.fetcher),
    settingsPatch.feed === undefined
      ? NO_ASSIGNMENTS
      : feedAssignments(settingsPatch.feed),
  ]);

  return clauses.length === 0
    ? undefined
    : {
        sql: `UPSERT type::record("setting", $id) SET ${['owner = $owner', ...clauses].join(', ')};`,
        bindings,
      };
};

const update = (db: Surreal, owner: OwnerId, settingsPatch: SettingsPatch) => {
  const statement = saveSql(settingsPatch);
  if (statement === undefined) {
    return Effect.void;
  }

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
