import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  credentialStatus,
  ReaderCredentials,
  saveReaderBrowserEndpoint,
} from '../../src';

it.effect('reports the browser provider as configured without a jina key', () =>
  Effect.gen(function* () {
    const status = yield* credentialStatus('alice');
    expect(status).toEqual({
      configured: true,
      jinaConfigured: false,
      provider: 'browser',
      browserEndpoint: 'http://127.0.0.1:9222',
    });
  }).pipe(
    Effect.provide(
      Layer.mock(ReaderCredentials, {
        provider: () => Effect.succeed('browser'),
        configured: () => Effect.succeed(false),
        browserEndpoint: () => Effect.succeed('http://127.0.0.1:9222'),
      })
    )
  )
);

it.effect(
  'reports the browser provider as unconfigured without an endpoint',
  () =>
    Effect.gen(function* () {
      const status = yield* credentialStatus('alice');
      expect(status).toEqual({
        configured: false,
        jinaConfigured: false,
        provider: 'browser',
        browserEndpoint: '',
      });
    }).pipe(
      Effect.provide(
        Layer.mock(ReaderCredentials, {
          provider: () => Effect.succeed('browser'),
          configured: () => Effect.succeed(false),
          browserEndpoint: () => Effect.undefined,
        })
      )
    )
);

it.effect('returns the saved browser endpoint in settings', () =>
  Effect.gen(function* () {
    const status = yield* credentialStatus('alice');
    expect(status).toEqual({
      configured: true,
      jinaConfigured: true,
      provider: 'jina',
      browserEndpoint: 'ws://127.0.0.1:9222',
    });
  }).pipe(
    Effect.provide(
      Layer.mock(ReaderCredentials, {
        provider: () => Effect.succeed('jina'),
        configured: () => Effect.succeed(true),
        browserEndpoint: () => Effect.succeed('ws://127.0.0.1:9222'),
      })
    )
  )
);

it.effect('reports jina configuration from the stored key', () =>
  Effect.gen(function* () {
    const status = yield* credentialStatus('alice');
    expect(status).toEqual({
      configured: true,
      jinaConfigured: true,
      provider: 'jina',
      browserEndpoint: '',
    });
  }).pipe(
    Effect.provide(
      Layer.mock(ReaderCredentials, {
        provider: () => Effect.succeed('jina'),
        configured: () => Effect.succeed(true),
        browserEndpoint: () => Effect.undefined,
      })
    )
  )
);

it.effect('stores trimmed browser endpoints allowing local addresses', () =>
  Effect.gen(function* () {
    const saved: string[] = [];
    const credentials = Layer.mock(ReaderCredentials, {
      setBrowserEndpoint: (_owner, endpoint) => {
        saved.push(endpoint);

        return Effect.void;
      },
    });
    const endpoints = [
      '  http://127.0.0.1:9222  ',
      'http://localhost:9222',
      'http://192.168.1.20:9222',
      'ws://10.0.0.5:9222',
      'wss://browser.internal:9222',
      'https://browser.example.com/devtools',
    ];

    for (const endpoint of endpoints) {
      expect(
        yield* saveReaderBrowserEndpoint('alice', endpoint).pipe(
          Effect.provide(credentials)
        )
      ).toEqual({ ok: true });
    }

    expect(saved).toEqual([
      'http://127.0.0.1:9222',
      'http://localhost:9222',
      'http://192.168.1.20:9222',
      'ws://10.0.0.5:9222',
      'wss://browser.internal:9222',
      'https://browser.example.com/devtools',
    ]);
  })
);

it.effect('clears the browser endpoint with an empty value', () =>
  Effect.gen(function* () {
    const saved: string[] = [];
    const credentials = Layer.mock(ReaderCredentials, {
      setBrowserEndpoint: (_owner, endpoint) => {
        saved.push(endpoint);

        return Effect.void;
      },
    });

    expect(
      yield* saveReaderBrowserEndpoint('alice', '   ').pipe(
        Effect.provide(credentials)
      )
    ).toEqual({ ok: true });
    expect(saved).toEqual(['']);
  })
);

it.effect('rejects invalid browser endpoints without storing them', () =>
  Effect.gen(function* () {
    const credentials = Layer.mock(ReaderCredentials, {
      setBrowserEndpoint: () =>
        Effect.die('invalid endpoint must not be stored'),
    });
    const endpoints = [
      'not-a-url',
      'ftp://127.0.0.1:9222',
      'file:///tmp/browser',
      'http://user:secret@127.0.0.1:9222',
      'https://browser.example.com/#devtools',
      'https://browser.example.com/#',
      `https://browser.example.com/${'a'.repeat(2048)}`,
    ];

    for (const endpoint of endpoints) {
      const error = yield* Effect.flip(
        saveReaderBrowserEndpoint('alice', endpoint).pipe(
          Effect.provide(credentials)
        )
      );
      expect(error._tag).toBe('ArticleFailure');
    }
  })
);
