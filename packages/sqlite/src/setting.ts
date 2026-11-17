import {
  type OwnerId,
  Setting,
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

const decodeSettings = decodeRows(Setting);

const decodeDefault = Schema.decodeSync(Setting);

type Column = 'retention' | 'provider' | 'jina_key' | 'browser_endpoint';

const SELECT =
  'SELECT owner AS ownerId, retention, provider, jina_key AS jinaKey, browser_endpoint AS browserEndpoint FROM setting';

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const select = sql.literal(SELECT);

    const upsert = (
      owner: OwnerId,
      values: Partial<Record<Column, string | number | null>>
    ) =>
      sql`INSERT INTO setting ${sql.insert({ owner, ...values })} ON CONFLICT (owner) DO UPDATE SET ${sql.update(values)}`.pipe(
        Effect.asVoid,
        fail
      );

    return SettingRepository.of({
      // A NULL column is dropped before decoding, so the value's defaults fill
      // it (SET-GET-1). A decode failure is replaced before it reaches the
      // log, because its message carries the row and the row holds the key
      // and the endpoint (SET-VAL-4).
      get: (owner) =>
        sql`${select} WHERE owner = ${owner}`.pipe(
          Effect.flatMap((rows) =>
            decodeSettings(rows).pipe(
              Effect.mapError(() => 'stored setting row does not decode')
            )
          ),
          Effect.map(([stored = decodeDefault({ ownerId: owner })]) => stored),
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
