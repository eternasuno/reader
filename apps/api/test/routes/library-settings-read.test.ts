import { expect, it } from '@effect/vitest';
import { SettingRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  callJson,
  configureBoth,
  DEFAULT_SETTINGS,
  putRetention,
  readSettings,
  replaceSettingRepository,
  SETTING_RESPONSE_KEYS,
  settingsOf,
  signIn,
} from './library-settings-support';
import { makeHarness } from './library-support';

it.effect('reads the defaults for a new user', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      const result = yield* readSettings(harness, session.cookie);

      expect(result.status).toBe(200);
      expect(result.body).toEqual(DEFAULT_SETTINGS);
      expect(Object.keys(result.body ?? {}).sort()).toEqual(
        SETTING_RESPONSE_KEYS
      );
    })
  )
);

it.effect('never returns the stored key or browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* readSettings(harness, session.cookie);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
      expect(Object.keys(result.body ?? {}).sort()).toEqual(
        SETTING_RESPONSE_KEYS
      );
      expect(result.text).not.toContain('stored-jina-key');
      expect(result.text).not.toContain('stored-browser');
    })
  )
);

it.effect('keeps the settings of each user separate', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* signIn(harness, 'alice@example.com');
      const bob = yield* signIn(harness, 'bob@example.com');

      yield* configureBoth(harness, alice.cookie);
      yield* putRetention(harness, alice.cookie, { retention: 50 });

      expect(yield* settingsOf(harness, bob.cookie)).toEqual(DEFAULT_SETTINGS);
      expect(yield* settingsOf(harness, alice.cookie)).toEqual({
        retention: 50,
        provider: 'browser',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
    })
  )
);

it.effect('rejects every settings operation without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const calls = [
        callJson<object>(harness, { path: '/api/library/settings' }),
        callJson<object>(harness, {
          method: 'PUT',
          path: '/api/library/settings/retention',
          body: { retention: 50 },
        }),
        callJson<object>(harness, {
          method: 'PUT',
          path: '/api/library/settings/fetcher',
          body: { provider: 'jina' },
        }),
        callJson<object>(harness, {
          method: 'DELETE',
          path: '/api/library/settings/key',
        }),
      ];

      for (const result of yield* Effect.all(calls)) {
        expect(result.status).toBe(401);
        expect(result.body).toEqual({ error: 'Unauthorized' });
      }
    })
  )
);

it.effect('maps a repository failure to a server error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      replaceSettingRepository(harness, {
        get: () =>
          Effect.fail(
            new SettingRepositoryError({ message: 'storage failed' })
          ),
      });

      const result = yield* readSettings(harness, session.cookie);

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        _tag: 'SettingRepositoryError',
        message: '暂时无法访问设置，请稍后重试',
      });
    })
  )
);

it.effect('rejects settings writes from another origin', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      const origin = 'https://evil.example.com';

      yield* configureBoth(harness, session.cookie);
      yield* putRetention(harness, session.cookie, { retention: 200 });
      const results = yield* Effect.all([
        callJson<object>(harness, {
          method: 'PUT',
          path: '/api/library/settings/retention',
          cookie: session.cookie,
          origin,
          body: { retention: 250 },
        }),
        callJson<object>(harness, {
          method: 'PUT',
          path: '/api/library/settings/fetcher',
          cookie: session.cookie,
          origin,
          body: { provider: 'jina' },
        }),
        callJson<object>(harness, {
          method: 'DELETE',
          path: '/api/library/settings/key',
          cookie: session.cookie,
          origin,
        }),
      ]);

      for (const result of results) {
        expect(result.status).toBe(403);
      }

      expect(yield* settingsOf(harness, session.cookie)).toEqual({
        retention: 200,
        provider: 'browser',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
    })
  )
);
