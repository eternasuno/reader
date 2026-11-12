import { expect, it } from '@effect/vitest';
import { SettingRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  call,
  readFailure,
  readJson,
  sessionFor,
  storedFetcher,
} from './library-fixtures';
import { type Harness, makeHarness } from './library-support';

const SETTINGS = '/api/library/settings';
const SETTINGS_KEY = '/api/library/settings/key';

type FetcherBody = {
  readonly provider: string;
  readonly key?: string;
  readonly endpoint?: string;
};

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

const putFetcher = (harness: Harness, cookie: string, body: FetcherBody) =>
  call(harness, {
    method: 'PUT',
    path: '/api/library/settings/fetcher',
    cookie,
    body,
  });

const readSettings = (harness: Harness, cookie: string) =>
  call(harness, { path: SETTINGS, cookie });

it.effect('returns only the configured flags for the settings', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'stored-key',
      });
      yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
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

      const response = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
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
      yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'stored-key',
      });

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
        message: '保留数量必须是正整数',
      });
    })
  )
);

it.effect('rejects an unsupported browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
        endpoint: 'ftp://host',
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidEndpoint',
        message: '请输入有效的浏览器服务地址',
      });
    })
  )
);

it.effect('rejects an unknown provider', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putFetcher(harness, session.cookie, {
        provider: 'other',
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidProvider',
        message: '请选择有效的文章提取方式',
      });
    })
  )
);

it.effect('requires a browser endpoint for the browser provider', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
      });

      expect(response.status).toBe(422);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'BrowserEndpointRequired',
        message: '请填写浏览器服务地址',
      });
    })
  )
);

it.effect('keeps the stored key and endpoint when the input is blank', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'stored-key',
      });
      yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
        endpoint: 'ws://stored-browser:9222',
      });

      const key = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: '   ',
      });
      const endpoint = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
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

it.effect('maps a settings repository failure to a server error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      Object.assign(harness.repositories.setting, {
        get: () =>
          Effect.fail(
            new SettingRepositoryError({ message: 'storage failed' })
          ),
      });

      const response = yield* readSettings(harness, session.cookie);

      expect(response.status).toBe(500);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'SettingRepositoryError',
        message: '暂时无法访问设置，请稍后重试',
      });
    })
  )
);
