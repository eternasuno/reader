import { createHash } from 'node:crypto';
import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
  OwnerId,
  Retention,
  type Setting,
  type SettingPatch,
  SettingRepository,
  SettingRepositoryError,
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
  new SettingRepositoryError({
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
  query<Array<unknown>, SettingRepositoryError>(
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
  fetcher: NonNullable<SettingPatch['fetcher']>
): Assignments =>
  merge([
    fetcher.provider === undefined
      ? NO_ASSIGNMENTS
      : {
          clauses: ['provider = $provider'],
          bindings: { provider: fetcher.provider },
        },
    fetcher.jina === undefined || fetcher.jina.key === undefined
      ? NO_ASSIGNMENTS
      : optionalAssignment('jinaKey', fetcher.jina.key, Redacted.value),
    fetcher.browser === undefined || fetcher.browser.endpoint === undefined
      ? NO_ASSIGNMENTS
      : optionalAssignment(
          'browserEndpoint',
          fetcher.browser.endpoint,
          (endpoint) => Redacted.value(endpoint).href
        ),
  ]);

const feedAssignments = (
  feed: NonNullable<SettingPatch['feed']>
): Assignments =>
  feed.retention === undefined
    ? NO_ASSIGNMENTS
    : {
        clauses: ['retention = $retention'],
        bindings: { retention: feed.retention },
      };

const saveStatement = (patch: SettingPatch) => {
  const { clauses, bindings } = merge([
    patch.fetcher === undefined
      ? NO_ASSIGNMENTS
      : fetcherAssignments(patch.fetcher),
    patch.feed === undefined ? NO_ASSIGNMENTS : feedAssignments(patch.feed),
  ]);

  return clauses.length === 0
    ? undefined
    : {
        sql: `UPSERT type::record("setting", $id) SET ${['owner = $owner', ...clauses].join(', ')};`,
        bindings,
      };
};

const update = (db: Surreal, owner: OwnerId, patch: SettingPatch) => {
  const statement = saveStatement(patch);

  if (statement === undefined) {
    return Effect.void;
  }

  return query<unknown, SettingRepositoryError>(
    db,
    statement.sql,
    owner,
    statement.bindings,
    repositoryError
  ).pipe(Effect.asVoid);
};

export const makeSettings = (db: Surreal) =>
  SettingRepository.of({
    get: (owner) => load(db, owner),
    update: (owner, patch) => update(db, owner, patch),
  });

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return makeSettings(db);
  })
);
