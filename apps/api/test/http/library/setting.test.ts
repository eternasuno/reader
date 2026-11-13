import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  readFailure,
  readJson,
  sessionFor,
  storedFetcher,
} from '../../support/fixtures';
import { type Harness, makeHarness } from '../../support/harness';

const SETTINGS = '/api/library/settings';
const SETTINGS_KEY = '/api/library/settings/key';
const FETCHER_JINA = '/api/library/settings/fetcher/jina';
const FETCHER_BROWSER = '/api/library/settings/fetcher/browser';

type SettingsBody = {
  readonly retention: number;
  readonly provider: 'jina' | 'browser';
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
};

const putRetention = (harness: Harness, cookie: string, retention: number) =>
  call(harness, {
    method: 'PUT',
    path: '/api/library/settings/retention',
    cookie,
    body: { retention },
  });

const putJina = (
  harness: Harness,
  cookie: string,
  body: { readonly key?: string }
) =>
  call(harness, {
    method: 'PUT',
    path: FETCHER_JINA,
    cookie,
    body,
  });

const putBrowser = (
  harness: Harness,
  cookie: string,
  body: { readonly endpoint?: string }
) =>
  call(harness, {
    method: 'PUT',
    path: FETCHER_BROWSER,
    cookie,
    body,
  });

const readSettings = (harness: Harness, cookie: string) =>
  call(harness, { path: SETTINGS, cookie });

it.effect('SET-VAL-4 returns only the configured flags for the settings', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* putJina(harness, session.cookie, { key: 'stored-key' });
      yield* putBrowser(harness, session.cookie, {
        endpoint: 'ws://stored-browser:9222',
      });

      const response = yield* readSettings(harness, session.cookie);
      const text = yield* Effect.promise(() => response.text());
      const body = JSON.parse(text) as SettingsBody;

      expect(response.status).toBe(200);
      expect(body).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
      expect(Object.keys(body).sort()).toEqual([
        'browserEndpointConfigured',
        'jinaKeyConfigured',
        'provider',
        'retention',
      ]);
      expect(text).not.toContain('stored-key');
      expect(text).not.toContain('stored-browser');
    })
  )
);

it.effect('stores the retention', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putRetention(harness, session.cookie, 60);
      const stored = yield* readSettings(harness, session.cookie);

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(response))).toEqual({
        ok: true,
      });
      expect(
        (yield* Effect.promise(() => readJson<SettingsBody>(stored))).retention
      ).toBe(60);
    })
  )
);

it.effect('stores the Jina key', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putJina(harness, session.cookie, {
        key: 'a-jina-key',
      });
      const stored = yield* readSettings(harness, session.cookie);

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(response))).toEqual({
        ok: true,
      });
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'jina',
        key: 'a-jina-key',
        endpoint: undefined,
      });
      expect(
        (yield* Effect.promise(() => readJson<SettingsBody>(stored)))
          .jinaKeyConfigured
      ).toBe(true);
    })
  )
);

it.effect('deletes the stored Jina key', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* putJina(harness, session.cookie, { key: 'stored-key' });

      const response = yield* call(harness, {
        method: 'DELETE',
        path: SETTINGS_KEY,
        cookie: session.cookie,
      });
      const stored = yield* readSettings(harness, session.cookie);

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(response))).toEqual({
        ok: true,
      });
      expect(
        (yield* Effect.promise(() => readJson<SettingsBody>(stored)))
          .jinaKeyConfigured
      ).toBe(false);
      expect(
        (yield* storedFetcher(harness, session.owner)).key
      ).toBeUndefined();
    })
  )
);

it.effect('rejects a retention below one', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putRetention(harness, session.cookie, 0);

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidRetention',
      });
    })
  )
);

it.effect('rejects an unsupported browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putBrowser(harness, session.cookie, {
        endpoint: 'ftp://host',
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidEndpoint',
      });
    })
  )
);

it.effect(
  'SET-FETCH-3 requires a browser endpoint for the browser provider',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* sessionFor(harness, 'alice@example.com');

        const response = yield* putBrowser(harness, session.cookie, {});

        expect(response.status).toBe(422);
        expect(yield* Effect.promise(() => readFailure(response))).toEqual({
          _tag: 'BrowserEndpointRequired',
        });
      })
    )
);

it.effect(
  'SET-VAL-6 keeps the stored key and endpoint when the input is blank',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* sessionFor(harness, 'alice@example.com');
        yield* putJina(harness, session.cookie, { key: 'stored-key' });
        yield* putBrowser(harness, session.cookie, {
          endpoint: 'ws://stored-browser:9222',
        });

        const key = yield* putJina(harness, session.cookie, { key: '   ' });
        const endpoint = yield* putBrowser(harness, session.cookie, {
          endpoint: '   ',
        });

        expect(key.status).toBe(200);
        expect(endpoint.status).toBe(200);
        expect(yield* storedFetcher(harness, session.owner)).toEqual({
          provider: 'browser',
          key: 'stored-key',
          endpoint: 'ws://stored-browser:9222/',
        });
      })
    )
);
