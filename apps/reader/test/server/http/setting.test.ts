import { expect, it } from '@effect/vitest';
import { BrowserEndpoint, JinaKey, SettingRepository } from '@reader/business';
import { alice } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { httpLayer } from './support';

const client = () => HttpApiTest.groups(ReaderApi, ['setting']);

const secretKey = 'sk-secret';

const storedKey = Schema.decodeSync(JinaKey)(secretKey);

const storedEndpoint = Schema.decodeSync(BrowserEndpoint)(
  'ws://127.0.0.1:9222'
);

it.effect('GET /api/settings SET-GET-1 answers the defaults', () =>
  Effect.gen(function* () {
    const api = yield* client();

    expect(yield* api.setting.getSetting()).toEqual({
      retention: 100,
      provider: 'jina',
      jinaKeyConfigured: false,
      browserEndpointConfigured: false,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/settings SET-VAL-4 never shows a secret', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    yield* settings.selectJinaWithKey(alice, storedKey);
    yield* settings.selectBrowserWithEndpoint(alice, storedEndpoint);
    const api = yield* client();
    const response = yield* api.setting.getSetting({
      responseMode: 'response-only',
    });
    const body = yield* response.json;

    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      'browserEndpointConfigured',
      'jinaKeyConfigured',
      'provider',
      'retention',
    ]);
    expect(JSON.stringify(body)).not.toContain(secretKey);
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PUT /api/settings/retention SET-VAL-1 rejects zero', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api.setting.setRetention({
      payload: { retention: 0 },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({ _tag: 'InvalidRetention' });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PUT /api/settings/retention SET-VAL-1 stores a valid value', () =>
  Effect.gen(function* () {
    const api = yield* client();
    yield* api.setting.setRetention({ payload: { retention: 7 } });

    expect(yield* api.setting.getSetting()).toMatchObject({ retention: 7 });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/fetcher/jina SET-FETCH-1 keeps the key secret',
  () =>
    Effect.gen(function* () {
      const api = yield* client();
      yield* api.setting.useJinaFetcher({ payload: { key: secretKey } });
      const settings = yield* SettingRepository;
      const stored = yield* settings.get(alice);

      expect(Option.isSome(stored.jinaKey)).toBe(true);
      expect(yield* api.setting.getSetting()).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKeyConfigured: true,
        browserEndpointConfigured: false,
      });
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/fetcher/browser SET-FETCH-3 needs an endpoint',
  () =>
    Effect.gen(function* () {
      const api = yield* client();
      const response = yield* api.setting.useBrowserFetcher({
        payload: {},
        responseMode: 'response-only',
      });

      expect(response.status).toBe(422);
      expect(yield* response.json).toEqual({ _tag: 'BrowserEndpointRequired' });
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/fetcher/browser SET-VAL-3 rejects another protocol',
  () =>
    Effect.gen(function* () {
      const api = yield* client();
      const response = yield* api.setting.useBrowserFetcher({
        payload: { endpoint: 'ftp://127.0.0.1:9222' },
        responseMode: 'response-only',
      });

      expect(response.status).toBe(400);
      expect(yield* response.json).toEqual({ _tag: 'InvalidEndpoint' });
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'DELETE /api/settings/fetcher/jina/key SET-KEY-2 clears the key',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      yield* settings.selectJinaWithKey(alice, storedKey);
      const api = yield* client();
      const response = yield* api.setting.removeJinaKey({
        responseMode: 'response-only',
      });
      const stored = yield* settings.get(alice);

      expect(response.status).toBe(204);
      expect(Option.isNone(stored.jinaKey)).toBe(true);
    }).pipe(Effect.provide(httpLayer()))
);
