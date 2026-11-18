import { expect, it } from '@effect/vitest';
import { BrowserEndpoint, JinaKey, SettingRepository } from '@reader/business';
import { alice } from '@reader/business/testing';
import { DateTime, Effect, Option, Schema } from 'effect';
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

const secretPassword = 'smtp-secret';

/** The required values of a delivery (SET-KINDLE-1). */
const delivery = {
  kindleEmail: 'reader@kindle.com',
  senderEmail: 'me@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecurity: 'tls',
};

const deliveryWithSecrets = {
  ...delivery,
  smtpUser: 'login',
  smtpPassword: secretPassword,
  sendTime: '07:00',
};

it.effect(
  'GET /api/settings SET-KINDLE-5 answers no kindle before it is saved',
  () =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/kindle SET-KINDLE-2 stores it and answers no password',
  () =>
    Effect.gen(function* () {
      const api = yield* client();
      yield* api.setting.setKindle({ payload: deliveryWithSecrets });
      const response = yield* api.setting.getSetting({
        responseMode: 'response-only',
      });
      const body = yield* response.json;

      expect(body).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKeyConfigured: false,
        browserEndpointConfigured: false,
        kindle: {
          kindleEmail: 'reader@kindle.com',
          senderEmail: 'me@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpSecurity: 'tls',
          smtpUser: 'login',
          sendTime: '07:00',
          smtpPasswordConfigured: true,
        },
      });
      expect(JSON.stringify(body)).not.toContain(secretPassword);
    }).pipe(Effect.provide(httpLayer()))
);

it.effect('PUT /api/settings/kindle SET-KINDLE-1 rejects a broken value', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const api = yield* client();
    const response = yield* api.setting.setKindle({
      payload: { ...deliveryWithSecrets, kindleEmail: 'kindle' },
      responseMode: 'response-only',
    });
    const stored = yield* settings.get(alice);

    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({ _tag: 'InvalidKindleSetting' });
    expect(Option.isNone(stored.kindle)).toBe(true);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/kindle SET-KINDLE-3 keeps the password and drops a blank send time',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const api = yield* client();
      yield* api.setting.setKindle({ payload: deliveryWithSecrets });
      yield* api.setting.setKindle({ payload: { ...delivery, sendTime: '' } });
      const stored = yield* settings.get(alice);
      const read = yield* api.setting.getSetting();

      expect(Option.isSome(stored.smtpPassword)).toBe(true);
      expect(read.kindle).not.toHaveProperty('sendTime');
      expect(read.kindle).toMatchObject({ smtpPasswordConfigured: true });
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'DELETE /api/settings/kindle/password SET-KINDLE-4 clears the password',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const api = yield* client();
      yield* api.setting.setKindle({ payload: deliveryWithSecrets });
      const response = yield* api.setting.removeSmtpPassword({
        responseMode: 'response-only',
      });
      const stored = yield* settings.get(alice);
      const read = yield* api.setting.getSetting();

      expect(response.status).toBe(204);
      expect(Option.isNone(stored.smtpPassword)).toBe(true);
      expect(read.kindle).toMatchObject({ smtpPasswordConfigured: false });
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/kindle KD-SCHED-1 stores the next send after now',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const api = yield* client();
      const before = yield* DateTime.now;

      yield* api.setting.setKindle({ payload: deliveryWithSecrets });

      const setting = yield* settings.get(alice);
      const next = DateTime.toEpochMillis(
        Option.getOrThrow(setting.nextSendAt)
      );

      expect(next).toBeGreaterThan(DateTime.toEpochMillis(before));
      expect(next).toBeLessThanOrEqual(
        DateTime.toEpochMillis(before) + 24 * 60 * 60 * 1000
      );
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/kindle KD-SCHED-1 a save without a time clears the next send',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const api = yield* client();

      yield* api.setting.setKindle({ payload: deliveryWithSecrets });
      yield* api.setting.setKindle({ payload: delivery });

      expect(Option.isNone((yield* settings.get(alice)).nextSendAt)).toBe(true);
    }).pipe(Effect.provide(httpLayer()))
);

it.effect(
  'PUT /api/settings/kindle SET-KINDLE-1 rejects a time off the half hour',
  () =>
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const api = yield* client();
      const response = yield* api.setting.setKindle({
        payload: { ...deliveryWithSecrets, sendTime: '07:15' },
        responseMode: 'response-only',
      });

      expect(response.status).toBe(400);
      expect(yield* response.json).toEqual({ _tag: 'InvalidKindleSetting' });
      expect(Option.isNone((yield* settings.get(alice)).kindle)).toBe(true);
    }).pipe(Effect.provide(httpLayer()))
);
