import { expect, it } from '@effect/vitest';
import { SettingRepositoryError } from '@reader/business';
import { Effect } from 'effect';
import {
  configureBoth,
  putFetcher,
  replaceSettingRepository,
  settingsOf,
  signIn,
  storedFetcher,
} from './library-settings-support';
import { makeHarness } from './library-support';

it.effect('rejects a key with a line break', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'line\nbreak',
      });

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        _tag: 'InvalidKey',
        message: '请输入有效的 Jina API Key',
      });
      expect((yield* storedFetcher(harness, session.owner)).key).toBe(
        'stored-jina-key'
      );
    })
  )
);

it.effect('rejects a key longer than 2048 characters', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'a'.repeat(2049),
      });

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        _tag: 'InvalidKey',
        message: '请输入有效的 Jina API Key',
      });
      expect((yield* storedFetcher(harness, session.owner)).key).toBe(
        'stored-jina-key'
      );
    })
  )
);

it.effect('accepts a key of exactly 2048 characters', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'b'.repeat(2048),
      });

      expect(result.status).toBe(200);
      expect((yield* storedFetcher(harness, session.owner)).key).toHaveLength(
        2048
      );
    })
  )
);

const badEndpoints = [
  { name: 'an unsupported protocol', endpoint: 'ftp://host' },
  { name: 'text that is not a URL', endpoint: 'not a url' },
];

for (const { name, endpoint } of badEndpoints) {
  it.effect(`rejects ${name} as a browser endpoint`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* signIn(harness, 'alice@example.com');

        yield* configureBoth(harness, session.cookie);
        const result = yield* putFetcher(harness, session.cookie, {
          provider: 'browser',
          endpoint,
        });

        expect(result.status).toBe(400);
        expect(result.body).toEqual({
          _tag: 'InvalidEndpoint',
          message: '请输入有效的浏览器服务地址',
        });
        expect((yield* storedFetcher(harness, session.owner)).endpoint).toBe(
          'ws://stored-browser:9222/'
        );
      })
    )
  );
}

it.effect('accepts a ws browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
        endpoint: 'ws://host:9222',
      });

      expect(result.status).toBe(200);
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'browser',
        key: undefined,
        endpoint: 'ws://host:9222/',
      });
      expect((yield* settingsOf(harness, session.cookie)).provider).toBe(
        'browser'
      );
    })
  )
);

it.effect('rejects an unknown provider', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const results = yield* Effect.all([
        putFetcher(harness, session.cookie, { provider: 'other' }),
        putFetcher(harness, session.cookie, { provider: '' }),
      ]);

      for (const result of results) {
        expect(result.status).toBe(400);
        expect(result.body).toEqual({
          _tag: 'InvalidProvider',
          message: '请选择有效的文章提取方式',
        });
      }

      expect((yield* settingsOf(harness, session.cookie)).provider).toBe(
        'browser'
      );
    })
  )
);

it.effect('rejects a missing provider at the schema boundary', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      const result = yield* putFetcher(harness, session.cookie, {});

      expect(result.status).toBe(400);
      expect(result.body).toBeUndefined();
      expect((yield* settingsOf(harness, session.cookie)).provider).toBe(
        'jina'
      );
    })
  )
);

it.effect('never echoes the submitted key or endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      const longKey = 'c'.repeat(2049);

      yield* configureBoth(harness, session.cookie);
      const results = yield* Effect.all([
        putFetcher(harness, session.cookie, {
          provider: 'jina',
          key: 'leaked-key\nvalue',
        }),
        putFetcher(harness, session.cookie, { provider: 'jina', key: longKey }),
        putFetcher(harness, session.cookie, {
          provider: 'browser',
          endpoint: 'ftp://leaked-host',
        }),
        putFetcher(harness, session.cookie, {
          provider: 'browser',
          endpoint: 'leaked endpoint text',
        }),
      ]);

      for (const result of results) {
        expect(result.status).toBe(400);
        expect(result.text).not.toContain('leaked');
        expect(result.text).not.toContain(longKey);
        expect(result.text).not.toContain('stored-jina-key');
        expect(result.text).not.toContain('stored-browser');
      }
    })
  )
);

it.effect('maps a repository failure to a server error', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');
      const storageFailure = () =>
        Effect.fail(new SettingRepositoryError({ message: 'storage failed' }));

      replaceSettingRepository(harness, { update: storageFailure });
      const jina = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'a-key',
      });

      replaceSettingRepository(harness, { get: storageFailure });
      const browser = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
      });

      for (const result of [jina, browser]) {
        expect(result.status).toBe(500);
        expect(result.body).toEqual({
          _tag: 'SettingRepositoryError',
          message: '暂时无法访问设置，请稍后重试',
        });
      }
    })
  )
);
