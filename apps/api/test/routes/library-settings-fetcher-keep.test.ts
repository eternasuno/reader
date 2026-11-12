import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  configureBoth,
  type FetcherBody,
  putFetcher,
  settingsOf,
  signIn,
  storedFetcher,
} from './library-settings-support';
import { makeHarness } from './library-support';

const withoutKey: ReadonlyArray<{ name: string; body: FetcherBody }> = [
  { name: 'omitted', body: { provider: 'jina' } },
  { name: 'empty', body: { provider: 'jina', key: '' } },
  { name: 'blank', body: { provider: 'jina', key: '   ' } },
];

const withoutEndpoint: ReadonlyArray<{ name: string; body: FetcherBody }> = [
  { name: 'omitted', body: { provider: 'browser' } },
  { name: 'empty', body: { provider: 'browser', endpoint: '' } },
  { name: 'blank', body: { provider: 'browser', endpoint: '   ' } },
];

for (const { name, body } of withoutKey) {
  it.effect(`keeps the stored Jina key when the key is ${name}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* signIn(harness, 'alice@example.com');

        yield* configureBoth(harness, session.cookie);
        const result = yield* putFetcher(harness, session.cookie, body);

        expect(result.status).toBe(200);
        expect(result.body).toEqual({ ok: true });
        expect(yield* storedFetcher(harness, session.owner)).toEqual({
          provider: 'jina',
          key: 'stored-jina-key',
          endpoint: 'ws://stored-browser:9222/',
        });
        expect(yield* settingsOf(harness, session.cookie)).toEqual({
          retention: 100,
          provider: 'jina',
          jinaKeyConfigured: true,
          browserEndpointConfigured: true,
        });
      })
    )
  );
}

for (const { name, body } of withoutEndpoint) {
  it.effect(`keeps the stored browser endpoint when it is ${name}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* signIn(harness, 'alice@example.com');

        yield* configureBoth(harness, session.cookie);
        const result = yield* putFetcher(harness, session.cookie, body);

        expect(result.status).toBe(200);
        expect(yield* storedFetcher(harness, session.owner)).toEqual({
          provider: 'browser',
          key: 'stored-jina-key',
          endpoint: 'ws://stored-browser:9222/',
        });
        expect((yield* settingsOf(harness, session.cookie)).provider).toBe(
          'browser'
        );
      })
    )
  );
}

it.effect('stores a new Jina key and keeps the browser endpoint', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'jina',
        key: 'fresh-jina-key',
      });

      expect(result.status).toBe(200);
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'jina',
        key: 'fresh-jina-key',
        endpoint: 'ws://stored-browser:9222/',
      });
      expect(yield* settingsOf(harness, session.cookie)).toEqual({
        retention: 100,
        provider: 'jina',
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      });
    })
  )
);

it.effect('replaces the browser endpoint and keeps the Jina key', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const result = yield* putFetcher(harness, session.cookie, {
        provider: 'browser',
        endpoint: 'http://new-browser:9222',
      });

      expect(result.status).toBe(200);
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'browser',
        key: 'stored-jina-key',
        endpoint: 'http://new-browser:9222/',
      });
    })
  )
);

for (const { name, body } of withoutEndpoint) {
  it.effect(`requires an endpoint when the browser input is ${name}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const session = yield* signIn(harness, 'alice@example.com');

        const result = yield* putFetcher(harness, session.cookie, body);

        expect(result.status).toBe(422);
        expect(result.body).toEqual({
          _tag: 'BrowserEndpointRequired',
          message: '请填写浏览器服务地址',
        });
        expect(yield* storedFetcher(harness, session.owner)).toEqual({
          provider: 'jina',
          key: undefined,
          endpoint: undefined,
        });
        expect(yield* settingsOf(harness, session.cookie)).toEqual({
          retention: 100,
          provider: 'jina',
          jinaKeyConfigured: false,
          browserEndpointConfigured: false,
        });
      })
    )
  );
}

it.effect('keeps both configurations while switching providers', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* signIn(harness, 'alice@example.com');

      yield* configureBoth(harness, session.cookie);
      const switched = yield* Effect.all([
        putFetcher(harness, session.cookie, { provider: 'jina' }),
        putFetcher(harness, session.cookie, { provider: 'browser' }),
      ]);

      expect(switched.map((result) => result.status)).toEqual([200, 200]);
      expect(yield* storedFetcher(harness, session.owner)).toEqual({
        provider: 'browser',
        key: 'stored-jina-key',
        endpoint: 'ws://stored-browser:9222/',
      });
    })
  )
);
