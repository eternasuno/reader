import {
  type OwnerId,
  Setting,
  SettingRepository,
  SettingRepositoryError,
} from '@reader/business';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import { dateFromMillis, decodeRows, failWith, millisOrNull } from './sql';

const fail = failWith(
  () =>
    new SettingRepositoryError({
      message: 'Failed to access extraction settings',
    })
);

type Row = Readonly<Record<string, unknown>>;

const withoutNulls = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));

/**
 * The Kindle group is stored as flat columns and decoded as one nested value
 * (SET-KINDLE-5): no `kindle_email` means no `kindle`, and a NULL field inside
 * it is dropped so it decodes as none.
 */
const withKindle = (row: Row): Row => {
  const {
    kindleEmail,
    senderEmail,
    smtpHost,
    smtpPort,
    smtpSecurity,
    smtpUser,
    sendTime,
    ...rest
  } = row;

  if (kindleEmail === null) return rest;

  return {
    ...rest,
    kindle: withoutNulls({
      kindleEmail,
      senderEmail,
      smtpHost,
      smtpPort,
      smtpSecurity,
      smtpUser,
      sendTime,
    }),
  };
};

const decodeSettings = decodeRows(Setting, (row) => {
  const { nextSendAt, ...rest } = row;

  return withKindle({ ...rest, nextSendAt: dateFromMillis(nextSendAt) });
});

const decodeDefault = Schema.decodeSync(Setting);

/**
 * The stored setting, or the defaults when no row is stored (SET-GET-1). A NULL
 * column is dropped before decoding, so the value's defaults fill it. A decode
 * failure is replaced before it reaches the log, because its message carries
 * the row and the row holds the key, the endpoint and the password (SET-VAL-4).
 */
const readSetting = (
  sql: SqlClient.SqlClient,
  select: Statement.Fragment,
  owner: OwnerId
) =>
  sql`${select} WHERE owner = ${owner}`.pipe(
    Effect.flatMap((rows) =>
      decodeSettings(rows).pipe(
        Effect.mapError(() => 'stored setting row does not decode')
      )
    ),
    Effect.map(([stored = decodeDefault({ ownerId: owner })]) => stored),
    fail
  );

type Column =
  | 'retention'
  | 'provider'
  | 'jina_key'
  | 'browser_endpoint'
  | 'kindle_email'
  | 'sender_email'
  | 'smtp_host'
  | 'smtp_port'
  | 'smtp_security'
  | 'smtp_user'
  | 'send_time'
  | 'smtp_password'
  | 'next_send_at';

const SELECT =
  'SELECT owner AS ownerId, retention, provider, jina_key AS jinaKey, browser_endpoint AS browserEndpoint, kindle_email AS kindleEmail, sender_email AS senderEmail, smtp_host AS smtpHost, smtp_port AS smtpPort, smtp_security AS smtpSecurity, smtp_user AS smtpUser, send_time AS sendTime, smtp_password AS smtpPassword, next_send_at AS nextSendAt FROM setting';

/** One write of the named columns; the first one creates the row (CM-PORT-3). */
const upsert = (
  sql: SqlClient.SqlClient,
  owner: OwnerId,
  values: Partial<Record<Column, string | number | null>>
) =>
  sql`INSERT INTO setting ${sql.insert({ owner, ...values })} ON CONFLICT (owner) DO UPDATE SET ${sql.update(values)}`.pipe(
    Effect.asVoid,
    fail
  );

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const select = sql.literal(SELECT);

    return SettingRepository.of({
      get: (owner) => readSetting(sql, select, owner),
      setRetention: (owner, retention) => upsert(sql, owner, { retention }),
      selectJina: (owner) => upsert(sql, owner, { provider: 'jina' }),
      selectJinaWithKey: (owner, key) =>
        upsert(sql, owner, {
          provider: 'jina',
          jina_key: Redacted.value(key),
        }),
      clearJinaKey: (owner) => upsert(sql, owner, { jina_key: null }),
      selectBrowser: (owner) => upsert(sql, owner, { provider: 'browser' }),
      selectBrowserWithEndpoint: (owner, endpoint) =>
        upsert(sql, owner, {
          provider: 'browser',
          browser_endpoint: Redacted.value(endpoint).href,
        }),
      // The whole group in one write; a given password replaces the stored
      // one, none keeps it (SET-KINDLE-3). The next send is the server's
      // computation, stored beside the group (KD-SCHED-1).
      setKindle: (owner, kindle, password, nextSendAt) => {
        const values = {
          kindle_email: kindle.kindleEmail,
          sender_email: kindle.senderEmail,
          smtp_host: kindle.smtpHost,
          smtp_port: kindle.smtpPort,
          smtp_security: kindle.smtpSecurity,
          smtp_user: Option.getOrNull(kindle.smtpUser),
          send_time: Option.getOrNull(kindle.sendTime),
          next_send_at: millisOrNull(nextSendAt),
        };

        return upsert(
          sql,
          owner,
          Option.isSome(password)
            ? { ...values, smtp_password: Redacted.value(password.value) }
            : values
        );
      },
      clearSmtpPassword: (owner) => upsert(sql, owner, { smtp_password: null }),
    });
  })
);
