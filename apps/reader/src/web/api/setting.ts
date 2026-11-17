import { SettingApi } from '../../contract';
import { type EncodedSuccess, request, requestJson } from './client';

/**
 * Settings: the retention, the fetcher choice and the Jina key (settings.md).
 * The browser endpoint and the Jina key are never read back, only reported as
 * configured (SET-VAL-4).
 */

const { endpoints } = SettingApi;

/**
 * The settings in their wire (JSON) form (SET-GET-2). `Retention` and
 * `FetcherProvider` carry decoding defaults, which mark them optional in
 * `Encoded` even though a decoded `SettingResponse` always has both fields.
 */
type Defined<T> = { readonly [K in keyof T]-?: Exclude<T[K], undefined> };

export type Setting = Defined<EncodedSuccess<typeof endpoints.getSetting>>;

/** The settings as the settings page reads them. */
export const getSetting = (): Promise<Setting> =>
  requestJson(endpoints.getSetting, (client) =>
    client.setting.getSetting({})
  ) as Promise<Setting>;

/** Sets how many items every feed keeps (SET-VAL-1). */
export const setRetention = (retention: number) =>
  request((client) => client.setting.setRetention({ payload: { retention } }));

/** Selects Jina, storing a key when one is given (SET-FETCH). */
export const useJinaFetcher = (key?: string) =>
  request((client) =>
    client.setting.useJinaFetcher({
      payload: key === undefined ? {} : { key },
    })
  );

/** Selects the browser service, storing an endpoint when one is given (SET-VAL-3). */
export const useBrowserFetcher = (endpoint?: string) =>
  request((client) =>
    client.setting.useBrowserFetcher({
      payload: endpoint === undefined ? {} : { endpoint },
    })
  );

/** Removes the stored Jina key, so Jina is used anonymously (SET-FETCH-1). */
export const removeJinaKey = () =>
  request((client) => client.setting.removeJinaKey({}));
