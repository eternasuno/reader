import { expect, it } from '@effect/vitest';
import { WebpageFetcher } from '@reader/business';
import { Effect, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { vi } from 'vitest';
import { BrowserWebpageFetcherLive, JinaWebpageFetcherLive } from '../src';

const key = Redacted.make('secret');

const article = 'https://example.com/article';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const html = '<html><body><p>Body</p></body></html>';

it.effect('sends Jina credentials and returns the fetched html', () =>
  Effect.gen(function* () {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), init };

      return Promise.resolve(new Response(html, { status: 200 }));
    };
    const fetcher = yield* WebpageFetcher;
    const result = yield* fetcher
      .fetch(article)
      .pipe(provideFetch(fetchImpl as typeof globalThis.fetch));
    const headers = new Headers(seen?.init?.headers);

    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('x-return-format')).toBe('html');
  }).pipe(Effect.provide(JinaWebpageFetcherLive(key)))
);

it.effect('reports Jina failures as WebpageFetcherError', () =>
  Effect.gen(function* () {
    const fetchImpl = () =>
      Promise.resolve(new Response('denied', { status: 403 }));
    const fetcher = yield* WebpageFetcher;
    const failure = yield* Effect.flip(
      fetcher
        .fetch(article)
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Jina request failed with status 403');
  }).pipe(Effect.provide(JinaWebpageFetcherLive(key)))
);

it.effect('reports browser failures as WebpageFetcherError', () =>
  Effect.gen(function* () {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new Error('Discovery refused'))
    );
    const fetcher = yield* WebpageFetcher;
    const failure = yield* Effect.flip(fetcher.fetch(article));

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Browser discovery failed');
  }).pipe(
    Effect.provide(BrowserWebpageFetcherLive('http://127.0.0.1:9222')),
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
  )
);
