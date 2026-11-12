import { expect } from '@effect/vitest';
import type { ISettingRepository, OwnerId } from '@reader/business';
import { Effect, Option, Redacted } from 'effect';
import type { CallOptions, Harness } from './library-support';

export type SettingsBody = {
  readonly retention: number;
  readonly provider: 'jina' | 'browser';
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
};

export type OkBody = { readonly ok: boolean };

export type FailureBody = {
  readonly _tag: string;
  readonly message: string;
};

export type FetcherBody = {
  readonly provider?: string;
  readonly key?: string;
  readonly endpoint?: string;
};

export type JsonResult<A> = {
  readonly status: number;
  readonly text: string;
  readonly body: A | undefined;
};

export const DEFAULT_SETTINGS: SettingsBody = {
  retention: 100,
  provider: 'jina',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};

export const SETTING_RESPONSE_KEYS = [
  'browserEndpointConfigured',
  'jinaKeyConfigured',
  'provider',
  'retention',
];

export const callJson = <A>(
  harness: Harness,
  options: CallOptions
): Effect.Effect<JsonResult<A>> =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => harness.call(options));
    const text = yield* Effect.promise(() => response.text());

    return {
      status: response.status,
      text,
      body: text === '' ? undefined : (JSON.parse(text) as A),
    };
  });

export const signIn = (harness: Harness, email: string) =>
  Effect.promise(() => harness.signIn(email));

export const readSettings = (harness: Harness, cookie: string) =>
  callJson<SettingsBody>(harness, { path: '/api/library/settings', cookie });

export const settingsOf = (harness: Harness, cookie: string) =>
  Effect.gen(function* () {
    const result = yield* readSettings(harness, cookie);

    expect(result.status).toBe(200);

    return result.body as SettingsBody;
  });

export const putRetention = (
  harness: Harness,
  cookie: string,
  body: { readonly retention?: number }
) =>
  callJson<OkBody | FailureBody>(harness, {
    method: 'PUT',
    path: '/api/library/settings/retention',
    cookie,
    body,
  });

export const putFetcher = (
  harness: Harness,
  cookie: string,
  body: FetcherBody
) =>
  callJson<OkBody | FailureBody>(harness, {
    method: 'PUT',
    path: '/api/library/settings/fetcher',
    cookie,
    body,
  });

export const deleteKey = (harness: Harness, cookie: string) =>
  callJson<OkBody | FailureBody>(harness, {
    method: 'DELETE',
    path: '/api/library/settings/key',
    cookie,
  });

export const replaceSettingRepository = (
  harness: Harness,
  methods: Partial<ISettingRepository>
) => Object.assign(harness.repositories.setting, methods);

export const storedFetcher = (harness: Harness, owner: OwnerId) =>
  Effect.map(harness.repositories.setting.get(owner), (setting) => ({
    provider: setting.fetcher.provider,
    key: Option.map(setting.fetcher.jina.key, Redacted.value).pipe(
      Option.getOrUndefined
    ),
    endpoint: Option.map(
      setting.fetcher.browser.endpoint,
      (endpoint) => Redacted.value(endpoint).href
    ).pipe(Option.getOrUndefined),
  }));

export const configureBoth = (harness: Harness, cookie: string) =>
  Effect.gen(function* () {
    const key = yield* putFetcher(harness, cookie, {
      provider: 'jina',
      key: 'stored-jina-key',
    });
    const endpoint = yield* putFetcher(harness, cookie, {
      provider: 'browser',
      endpoint: 'ws://stored-browser:9222',
    });

    expect(key.status).toBe(200);
    expect(endpoint.status).toBe(200);
  });
