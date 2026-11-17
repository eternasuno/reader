import { SettingRepository, useBrowser, useJina } from '@reader/business';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import {
  decodeBrowserEndpoint,
  decodeJinaKey,
  decodeRetention,
} from './decode';
import { handle } from './errors';

/**
 * Exactly the four visible fields: the key and the endpoint are secrets and
 * never leave the business layer (SET-GET-2, SET-VAL-4).
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
    })
);
