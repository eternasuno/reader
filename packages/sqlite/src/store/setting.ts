import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
  OwnerId,
  Retention,
  SettingRepository,
  SettingRepositoryError,
} from '@reader/business';
import { Effect, Layer, Redacted, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { decodeRows, failWith } from './sql';

const fail = failWith(
  () =>
    new SettingRepositoryError({
      message: 'Failed to access extraction settings',
    })
);

const StoredSetting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: FetcherProvider,
  jinaKey: Schema.OptionFromOptional(JinaKey),
  browserEndpoint: Schema.OptionFromOptional(BrowserEndpoint),
});

const decodeSettings = decodeRows(StoredSetting);

const decodeDefault = Schema.decodeSync(StoredSetting);

type Column = 'retention' | 'provider' | 'jina_key' | 'browser_endpoint';

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsert = (
      owner: OwnerId,
      values: Partial<Record<Column, string | number | null>>
    ) =>
      sql`INSERT INTO setting ${sql.insert({ owner, ...values })} ON CONFLICT (owner) DO UPDATE SET ${sql.update(values)}`.pipe(
        Effect.asVoid,
        fail
      );

    return SettingRepository.of({
      get: (owner) =>
        sql`SELECT owner AS ownerId, retention, provider, jina_key AS jinaKey, browser_endpoint AS browserEndpoint FROM setting WHERE owner = ${owner}`.pipe(
          Effect.flatMap((rows) =>
            decodeSettings(rows).pipe(
              Effect.mapError(() => 'stored setting row does not decode')
            )
          ),
          Effect.map(([stored = decodeDefault({ ownerId: owner })]) => ({
            ownerId: stored.ownerId,
            feed: { retention: stored.retention },
            fetcher: {
              provider: stored.provider,
              jina: { key: stored.jinaKey },
              browser: { endpoint: stored.browserEndpoint },
            },
          })),
          fail
        ),
      setRetention: (owner, retention) => upsert(owner, { retention }),
      selectJina: (owner) => upsert(owner, { provider: 'jina' }),
      selectJinaWithKey: (owner, key) =>
        upsert(owner, { provider: 'jina', jina_key: Redacted.value(key) }),
      clearJinaKey: (owner) => upsert(owner, { jina_key: null }),
      selectBrowser: (owner) => upsert(owner, { provider: 'browser' }),
      selectBrowserWithEndpoint: (owner, endpoint) =>
        upsert(owner, {
          provider: 'browser',
          browser_endpoint: Redacted.value(endpoint).href,
        }),
    });
  })
);
