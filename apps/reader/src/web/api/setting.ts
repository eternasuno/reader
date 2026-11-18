import { SettingApi } from '../../contract';
import { type EncodedSuccess, request, requestJson } from './client';

/**
 * Settings: the retention, the fetcher choice, the Jina key and the Kindle
 * delivery (settings.md). The browser endpoint, the Jina key and the SMTP
 * password are never read back, only reported as configured (SET-VAL-4).
 */

const { endpoints } = SettingApi;

/**
 * The settings in their wire (JSON) form (SET-GET-2). `Retention` and
 * `FetcherProvider` carry decoding defaults, which mark them optional in
 * `Encoded` even though a decoded `SettingResponse` always has both fields.
 */
type Defined<T> = { readonly [K in keyof T]-?: Exclude<T[K], undefined> };

type SettingsWire = EncodedSuccess<typeof endpoints.getSetting>;

/**
 * The stored Kindle delivery as the page reads it: everything but the password,
 * of which only whether one is stored (SET-KINDLE-2). Absent until it is saved
 * (SET-KINDLE-5).
 */
export type KindleDelivery = NonNullable<SettingsWire['kindle']>;

/** The Kindle security of settings.md SET-KINDLE-1. */
export type KindleSecurity = KindleDelivery['smtpSecurity'];

/** The settings as the settings page reads them. */
export type Setting = Omit<Defined<SettingsWire>, 'kindle'> & {
  readonly kindle?: KindleDelivery | undefined;
};

/** Reads the settings, which report only whether a secret is stored (SET-GET-2). */
export const getSetting = (): Promise<Setting> =>
  requestJson(endpoints.getSetting, (client) =>
    client.setting.getSetting({})
  ) as Promise<Setting>;

/** A Kindle delivery as it is saved: blank optionals count as not given (SET-KINDLE-3). */
export type KindleInput = {
  readonly kindleEmail: string;
  readonly senderEmail: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecurity: KindleSecurity;
  readonly smtpUser?: string | undefined;
  readonly smtpPassword?: string | undefined;
  readonly sendTime?: string | undefined;
};

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

/** Saves the whole Kindle delivery in one write (SET-KINDLE-3). */
export const setKindle = (input: KindleInput) =>
  request((client) => client.setting.setKindle({ payload: input }));

/** Removes the stored SMTP password and nothing else (SET-KINDLE-4). */
export const removeSmtpPassword = () =>
  request((client) => client.setting.removeSmtpPassword({}));
