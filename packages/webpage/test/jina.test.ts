import { expect, it } from '@effect/vitest';
import { Effect, Fiber, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { vi } from 'vitest';
import { fetchJina } from '../src/jina';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

type FetchInput = Parameters<typeof globalThis.fetch>[0];

type FetchInit = Parameters<typeof globalThis.fetch>[1];

const key = Redacted.make('secret');

const article = 'https://example.com/article';

const html = '<html><body><p>Body</p></body></html>';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const textFetch =
  (body: string, status = 200, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(new Response(body, { status, headers }));

it.effect('returns Jina html with the target and credentials', () =>
  Effect.gen(function* () {
    let seen: { url: string; init: FetchInit | undefined } | undefined;
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      seen = { url: String(input), init };

      return textFetch(html)();
    };
    const result = yield* fetchJina(article, key).pipe(
      provideFetch(fetchImpl as typeof globalThis.fetch)
    );
    const headers = new Headers(seen?.init?.headers);
    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(seen?.init?.redirect).toBe('error');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('accept')).toBe('text/html');
    expect(headers.get('x-return-format')).toBe('html');
    expect(headers.get('x-timeout')).toBe('30');
  })
);

it.effect('omits credentials when no key is configured', () =>
  Effect.gen(function* () {
    let init: FetchInit | undefined;
    const fetchImpl = (_input: FetchInput, options?: FetchInit) => {
      init = options;

      return textFetch(html)();
    };
    const result = yield* fetchJina(article, undefined).pipe(
      provideFetch(fetchImpl as typeof globalThis.fetch)
    );
    expect(result).toBe(html);
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  })
);

it.effect(
  'reports distinct rate limit, rejected key and failure messages',
  () =>
    Effect.gen(function* () {
      const responses = [
        new Response('slow down', { status: 429 }),
        new Response('denied', { status: 401 }),
        new Response('denied', { status: 403 }),
        new Response('boom', { status: 502 }),
      ];
      const fetchImpl = () => {
        const response = responses.shift();

        if (!response) {
          throw new Error('Unexpected request');
        }

        return Promise.resolve(response);
      };
      const run = () =>
        Effect.flip(
          fetchJina(article, key).pipe(
            provideFetch(fetchImpl as typeof globalThis.fetch)
          )
        );
      expect((yield* run()).message).toBe('Jina rate limit exceeded');
      expect((yield* run()).message).toBe('Jina API key rejected');
      expect((yield* run()).message).toBe('Jina API key rejected');
      expect((yield* run()).message).toBe(
        'Jina request failed with status 502'
      );
    })
);

it.effect('rejects unsupported or credentialed targets before fetching', () =>
  Effect.gen(function* () {
    let called = false;
    const fetchImpl = () => {
      called = true;

      return Promise.resolve(new Response(html));
    };
    const addresses = [
      'ftp://example.com/article',
      'https://user:pass@example.com/article',
      'not a url',
    ];

    for (const address of addresses) {
      const error = yield* Effect.flip(
        fetchJina(address, key).pipe(
          provideFetch(fetchImpl as typeof globalThis.fetch)
        )
      );
      expect(error._tag).toBe('FetchFailure');
    }

    expect(called).toBe(false);
  })
);

it.effect('rejects redirects, failed statuses and oversized bodies', () =>
  Effect.gen(function* () {
    const responses = [
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example/' },
      }),
      new Response('no', { status: 502 }),
      new Response('a'.repeat(5 * 1024 * 1024 + 1)),
    ];
    const fetchImpl = () => {
      const response = responses.shift();

      if (!response) {
        throw new Error('Unexpected request');
      }

      return Promise.resolve(response);
    };
    const run = () =>
      Effect.flip(
        fetchJina(article, key).pipe(
          provideFetch(fetchImpl as typeof globalThis.fetch)
        )
      );
    const redirect = yield* run();
    const failed = yield* run();
    const oversized = yield* run();
    expect(redirect._tag).toBe('FetchFailure');
    expect(failed._tag).toBe('FetchFailure');
    expect(oversized._tag).toBe('FetchFailure');
  })
);

it.effect('reports a forty second timeout', () =>
  Effect.gen(function* () {
    let started = () => {};
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchImpl = () => {
      started();

      return new Promise<Response>(() => {});
    };
    const fiber = yield* fetchJina(article, key).pipe(
      provideFetch(fetchImpl as typeof globalThis.fetch),
      Effect.forkChild
    );
    yield* Effect.promise(() => sent);
    yield* TestClock.adjust('40 seconds');
    const error = yield* Fiber.join(fiber).pipe(Effect.flip);
    expect(error._tag).toBe('FetchFailure');
    expect(error.message).toBe('Jina request timed out');
  })
);
