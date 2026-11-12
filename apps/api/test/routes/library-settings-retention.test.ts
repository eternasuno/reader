import { expect, it } from '@effect/vitest';
import { SettingRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  configureBoth,
  DEFAULT_SETTINGS,
  putRetention,
  replaceSettingRepository,
  settingsOf,
  signIn,
  storedFetcher,
} from './library-settings-support';
import { makeHarness } from './library-support';

it.effect('stores the boundary retentions', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      for (const retention of [30, 300]) {
        const result = yield* putRetention(harness, session.cookie, {
          retention,
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ ok: true });
        expect((yield* settingsOf(harness, session.cookie)).retention).toBe(
          retention
        );
      }
    })
  )
);

it.effect('rejects retentions outside the range', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      for (const retention of [29, 301]) {
        const result = yield* putRetention(harness, session.cookie, {
          retention,
        });

        expect(result.status).toBe(400);
        expect(result.body).toEqual({
          _tag: 'InvalidRetention',
          message: '保留数量必须是 30 到 300 之间的整数',
        });
      }

      expect(yield* settingsOf(harness, session.cookie)).toEqual(
        DEFAULT_SETTINGS
      );
    })
  )
);

it.effect(
  'rejects a fractional or missing retention at the schema boundary',
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* signIn(harness, 'alice@example.com');

        const results = yield* Effect.all([
          putRetention(harness, session.cookie, { retention: 50.5 }),
          putRetention(harness, session.cookie, {}),
        ]);

        for (const result of results) {
          expect(result.status).toBe(400);
        }

        expect(yield* settingsOf(harness, session.cookie)).toEqual(
          DEFAULT_SETTINGS
        );
      })
    )
);

it.effect('stores the retention without touching the fetcher', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* putRetention(harness, session.cookie, {
        retention: 60,
      });

      expect(result.status).toBe(200);
      expect(yield* settingsOf(harness, session.cookie)).toEqual({
        retention: 60,
        provider: 'browser',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'browser',
        key: 'stored-jina-key',
        endpoint: 'ws://stored-browser:9222/',
      });
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

      const result = yield* putRetention(harness, session.cookie, {
        retention: 50,
      });

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        _tag: 'SettingRepositoryError',
        message: '暂时无法访问设置，请稍后重试',
      });
      expect((yield* settingsOf(harness, session.cookie)).retention).toBe(100);
    })
  )
);
