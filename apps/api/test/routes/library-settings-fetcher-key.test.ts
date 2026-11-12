import { expect, it } from '@effect/vitest';
import { SettingRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  callJson,
  configureBoth,
  DEFAULT_SETTINGS,
  deleteKey,
  putFetcher,
  replaceSettingRepository,
  settingsOf,
  signIn,
  storedFetcher,
} from './library-settings-support';
import { makeHarness } from './library-support';

it.effect('clears the stored key and keeps the provider and endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* deleteKey(harness, session.cookie);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'browser',
        key: undefined,
        endpoint: 'ws://stored-browser:9222/',
      });
      expect(yield* settingsOf(harness, session.cookie)).toEqual({
        retention: 100,
        provider: 'browser',
        jinaKeyConfigured: false,
        browserEndpointConfigured: true,
      });
    })
  )
);

it.effect('keeps the Jina provider when clearing the key', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      yield* putFetcher(harness, session.cookie, { provider: 'jina' });
      const result = yield* deleteKey(harness, session.cookie);

      expect(result.status).toBe(200);
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'jina',
        key: undefined,
        endpoint: 'ws://stored-browser:9222/',
      });
    })
  )
);

it.effect('is idempotent when no key is stored', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      const results = yield* Effect.all([
        deleteKey(harness, session.cookie),
        deleteKey(harness, session.cookie),
      ]);

      for (const result of results) {
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ ok: true });
      }

      expect(yield* settingsOf(harness, session.cookie)).toEqual(
        DEFAULT_SETTINGS
      );
    })
  )
);

it.effect('offers no way to remove the browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* callJson<object>(harness, {
        method: 'DELETE',
        path: '/api/library/settings/browser',
        cookie: session.cookie,
      });

      expect(result.status).toBe(404);
      expect((yield* storedFetcher(harness, session.owner)).endpoint).toBe(
        'ws://stored-browser:9222/'
      );
      expect(
        (yield* settingsOf(harness, session.cookie)).browserEndpointConfigured
      ).toBe(true);
    })
  )
);

it.effect('maps a repository failure to a server error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      replaceSettingRepository(harness, {
        update: () =>
          Effect.fail(
            new SettingRepositoryError({ message: 'storage failed' })
          ),
      });

      const result = yield* deleteKey(harness, session.cookie);

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        _tag: 'SettingRepositoryError',
        message: '暂时无法访问设置，请稍后重试',
      });
    })
  )
);
