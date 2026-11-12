import { expect, it } from '@effect/vitest';
import { Effect, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { fetchJina } from '../src/jina';

type FetchInput = Parameters<typeof globalThis.fetch>[0];

type FetchInit = Parameters<typeof globalThis.fetch>[1];

const key = Redacted.make('secret');

const article = 'https://example.com/article';

const html = '<html><body><p>Body</p></body></html>';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const textFetch =
  (body: string, status = 200) =>
  () =>
    Promise.resolve(new Response(body, { status }));

it.effect('requests Jina html for the target with the key', () =>
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
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('accept')).toBe('text/html');
    expect(headers.get('x-return-format')).toBe('html');
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

it.effect('fails with the response status on a non-2xx answer', () =>
  Effect.gen(function* () {
    const fetchImpl = () => textFetch('denied', 403)();
    const failure = yield* Effect.flip(
      fetchJina(article, key).pipe(
        provideFetch(fetchImpl as typeof globalThis.fetch)
      )
    );

    expect(failure._tag).toBe('FetchFailure');
    expect(failure.message).toBe('Jina request failed with status 403');
  })
);

it.effect('fails when the request cannot be sent', () =>
  Effect.gen(function* () {
    const fetchImpl = () => Promise.reject(new Error('Network down'));
    const failure = yield* Effect.flip(
      fetchJina(article, key).pipe(
        provideFetch(fetchImpl as typeof globalThis.fetch)
      )
    );

    expect(failure.message).toBe('Jina request failed');
  })
);
