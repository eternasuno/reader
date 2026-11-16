import {
  BrowserEndpoint,
  FetcherProvider,
  type ISettingRepository,
  JinaKey,
  OwnerId,
  Retention,
  type Setting,
  SettingRepository,
  SettingRepositoryError,
} from '@reader/business';
import { Effect, Redacted, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { decodeRows } from './sql';

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

const settingRepositoryError = () =>
  new SettingRepositoryError({
    message: 'Failed to access extraction settings',
  });

const defaultRow = (owner: OwnerId) =>
  Schema.decodeSync(StoredSetting)({ ownerId: owner });

const loadSetting = (sql: SqlClient.SqlClient, owner: OwnerId) =>
  sql`SELECT owner AS ownerId, retention, provider, jina_key AS jinaKey, browser_endpoint AS browserEndpoint FROM setting WHERE owner = ${owner}`.pipe(
    Effect.flatMap((rows) =>
      decodeRows(rows, StoredSetting, settingRepositoryError)
    ),
    Effect.map((rows) => settingOf(rows[0] ?? defaultRow(owner))),
    Effect.mapError(settingRepositoryError)
  );

export const makeSettingRepository: Effect.Effect<
  ISettingRepository,
  never,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return SettingRepository.of({
    get: (owner) => loadSetting(sql, owner),
    setRetention: (owner, retention) =>
      sql`INSERT INTO setting (owner, retention) VALUES (${owner}, ${retention}) ON CONFLICT (owner) DO UPDATE SET retention = excluded.retention`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
    selectJina: (owner) =>
      sql`INSERT INTO setting (owner, provider) VALUES (${owner}, 'jina') ON CONFLICT (owner) DO UPDATE SET provider = excluded.provider`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
    selectJinaWithKey: (owner, key) =>
      sql`INSERT INTO setting (owner, provider, jina_key) VALUES (${owner}, 'jina', ${Redacted.value(key)}) ON CONFLICT (owner) DO UPDATE SET provider = excluded.provider, jina_key = excluded.jina_key`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
    clearJinaKey: (owner) =>
      sql`INSERT INTO setting (owner, jina_key) VALUES (${owner}, NULL) ON CONFLICT (owner) DO UPDATE SET jina_key = NULL`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
    selectBrowser: (owner) =>
      sql`INSERT INTO setting (owner, provider) VALUES (${owner}, 'browser') ON CONFLICT (owner) DO UPDATE SET provider = excluded.provider`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
    selectBrowserWithEndpoint: (owner, endpoint) =>
      sql`INSERT INTO setting (owner, provider, browser_endpoint) VALUES (${owner}, 'browser', ${Redacted.value(endpoint).href}) ON CONFLICT (owner) DO UPDATE SET provider = excluded.provider, browser_endpoint = excluded.browser_endpoint`.pipe(
        Effect.asVoid,
        Effect.mapError(settingRepositoryError)
      ),
  });
});
