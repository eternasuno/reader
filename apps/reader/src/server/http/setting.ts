import {
  type Setting,
  SettingRepository,
  useBrowser,
  useJina,
} from '@reader/business';
import { DateTime, Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { nextOccurrence } from '../kindle/local-time';
import {
  decodeBrowserEndpoint,
  decodeJinaKey,
  decodeKindle,
  decodeRetention,
  decodeSmtpPassword,
} from './decode';
import { handle } from './errors';

/**
 * The stored Kindle delivery as the response, never its password (SET-KINDLE-2):
 * `smtpUser` and `sendTime` appear only when they are stored, and
 * `smtpPasswordConfigured` says whether one is.
 */
const kindleResponse = (setting: Setting) =>
  Option.map(setting.kindle, (kindle) => ({
    kindleEmail: kindle.kindleEmail,
    senderEmail: kindle.senderEmail,
    smtpHost: kindle.smtpHost,
    smtpPort: kindle.smtpPort,
    smtpSecurity: kindle.smtpSecurity,
    ...Option.match(kindle.smtpUser, {
      onNone: () => ({}),
      onSome: (smtpUser) => ({ smtpUser }),
    }),
    ...Option.match(kindle.sendTime, {
      onNone: () => ({}),
      onSome: (sendTime) => ({ sendTime }),
    }),
    smtpPasswordConfigured: Option.isSome(setting.smtpPassword),
  }));

/**
 * Exactly the four visible fields and, once saved, the Kindle delivery; the
 * key, the endpoint and the SMTP password are secrets and never leave the
 * business layer (SET-GET-2, SET-VAL-4, SET-KINDLE-5).
 */
const get = HttpApiBuilder.handler(ReaderApi, 'setting', 'getSetting', () =>
  handle((owner) =>
    Effect.map(
      Effect.flatMap(SettingRepository, (settings) => settings.get(owner)),
      (setting) => ({
        retention: setting.retention,
        provider: setting.provider,
        jinaKeyConfigured: Option.isSome(setting.jinaKey),
        browserEndpointConfigured: Option.isSome(setting.browserEndpoint),
        ...Option.match(kindleResponse(setting), {
          onNone: () => ({}),
          onSome: (kindle) => ({ kindle }),
        }),
      })
    )
  )
);

/** Retention N, an integer of at least 1 (SET-VAL-1). */
const setRetention = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'setRetention',
  ({ payload }) =>
    Effect.gen(function* () {
      const retention = yield* decodeRetention(payload.retention);

      yield* handle((owner) =>
        Effect.flatMap(SettingRepository, (settings) =>
          settings.setRetention(owner, retention)
        )
      );
    })
);

/** Chooses Jina, keeping or replacing the stored key (SET-FETCH-1). */
const useJinaFetcher = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'useJinaFetcher',
  ({ payload }) => handle((owner) => useJina(owner, decodeJinaKey(payload.key)))
);

/** Chooses the browser service, which needs an endpoint (SET-FETCH-2, SET-FETCH-3). */
const useBrowserFetcher = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'useBrowserFetcher',
  ({ payload }) =>
    Effect.gen(function* () {
      const endpoint = yield* decodeBrowserEndpoint(payload.endpoint);

      yield* handle((owner) => useBrowser(owner, endpoint));
    })
);

/** Removes the stored key; a missing key is a success (SET-KEY-2). */
const removeJinaKey = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'removeJinaKey',
  () =>
    handle((owner) =>
      Effect.flatMap(SettingRepository, (settings) =>
        settings.clearJinaKey(owner)
      )
    )
);

/**
 * Writes the whole Kindle delivery in one write; a password that is absent or
 * empty keeps the stored one (SET-KINDLE-3) and any value outside its rule is
 * `InvalidKindleSetting` (SET-KINDLE-1). The next send written with it is the
 * next occurrence of the saved time after now, or none without a time
 * (KD-SCHED-1).
 */
const setKindle = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'setKindle',
  ({ payload }) =>
    Effect.gen(function* () {
      const kindle = yield* decodeKindle(payload);
      const password = decodeSmtpPassword(payload.smtpPassword);
      const now = yield* DateTime.now;
      const nextSendAt = Option.map(kindle.sendTime, (sendTime) =>
        DateTime.fromDateUnsafe(
          new Date(nextOccurrence(DateTime.toEpochMillis(now), sendTime))
        )
      );

      yield* handle((owner) =>
        Effect.flatMap(SettingRepository, (settings) =>
          settings.setKindle(owner, kindle, password, nextSendAt)
        )
      );
    })
);

/** Removes the password and nothing else; no stored one is a success (SET-KINDLE-4). */
const removeSmtpPassword = HttpApiBuilder.handler(
  ReaderApi,
  'setting',
  'removeSmtpPassword',
  () =>
    handle((owner) =>
      Effect.flatMap(SettingRepository, (settings) =>
        settings.clearSmtpPassword(owner)
      )
    )
);

export const SettingHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'setting',
  (handlers) =>
    handlers.handleAll({
      getSetting: get,
      setRetention,
      useJinaFetcher,
      useBrowserFetcher,
      removeJinaKey,
      setKindle,
      removeSmtpPassword,
    })
);
