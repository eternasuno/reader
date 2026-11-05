import { expect, it } from '@effect/vitest';
import { WebpageFetcher } from '@reader/business';
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { vi } from 'vitest';
import {
  BrowserConcurrencyLive,
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '../src';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

const key = Redacted.make('secret');

const article = 'https://example.com/article';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const html = '<html><body><p>Body</p></body></html>';

const browserLayer = (endpoint: string | undefined) =>
  BrowserWebpageFetcherLive(endpoint).pipe(
    Layer.provide(BrowserConcurrencyLive)
  );

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
    expect(seen?.init?.redirect).toBe('error');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('x-return-format')).toBe('html');
  }).pipe(Effect.provide(JinaWebpageFetcherLive(key)))
);

it.effect('exposes distinct Jina failure messages', () =>
  Effect.gen(function* () {
    const responses = [
      new Response('slow down', { status: 429 }),
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
    const fetcher = yield* WebpageFetcher;
    const run = () =>
      Effect.flip(
        fetcher
          .fetch(article)
          .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
      );
    const limited = yield* run();
    const rejected = yield* run();
    const failed = yield* run();
    expect([limited.message, rejected.message, failed.message]).toEqual([
      'Jina rate limit exceeded',
      'Jina API key rejected',
      'Jina request failed with status 502',
    ]);
  }).pipe(Effect.provide(JinaWebpageFetcherLive(key)))
);

it.effect('requires a browser endpoint instead of an environment default', () =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const error = yield* Effect.flip(fetcher.fetch(article));
    expect(error._tag).toBe('WebpageFetcherError');
    expect(error.message).toBe('Browser service address is required');
  }).pipe(
    Effect.provide(
      Layer.merge(
        browserLayer(undefined),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            READER_BROWSER_ENDPOINT: 'http://127.0.0.1:9222',
          })
        )
      )
    )
  )
);

it.effect('rejects unsupported browser endpoint input before connecting', () =>
  Effect.gen(function* () {
    const fetchImpl = vi.fn(() => {
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('fetch', fetchImpl);
    const endpoints = [
      'ftp://127.0.0.1:9222',
      'http://user:secret@127.0.0.1:9222',
      'http://127.0.0.1:9222/#devtools',
    ];

    for (const endpoint of endpoints) {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const fetcher = yield* WebpageFetcher;

          return yield* fetcher.fetch(article);
        }).pipe(Effect.provide(browserLayer(endpoint)))
      );
      expect(error._tag).toBe('WebpageFetcherError');
      expect(error.message).toBe('Invalid browser service address');
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
);

it.effect('reports a forty second browser timeout', () =>
  Effect.gen(function* () {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const fetcher = yield* WebpageFetcher;
    const fiber = yield* fetcher
      .fetch('http://8.8.8.8/article')
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust('40 seconds');
    const error = yield* Fiber.join(fiber).pipe(Effect.flip);
    expect(error.message).toBe('Browser extraction timed out');
  }).pipe(
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())),
    Effect.provide(browserLayer('http://127.0.0.1:9222'))
  )
);

it.effect('limits shared browser concurrency to two permits', () =>
  Effect.gen(function* () {
    let active = 0;
    let peak = 0;
    const fetchImpl = () => {
      active += 1;
      peak = Math.max(peak, active);

      return new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          active -= 1;
          reject(new Error('Discovery failed'));
        }, 0);
      });
    };
    vi.stubGlobal('fetch', fetchImpl);
    const fetcher = yield* WebpageFetcher;

    yield* Effect.forEach(
      [1, 2, 3, 4],
      () => Effect.result(fetcher.fetch('http://8.8.8.8/article')),
      { concurrency: 'unbounded', discard: true }
    );
    expect(peak).toBe(2);
  }).pipe(
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())),
    Effect.provide(browserLayer('http://127.0.0.1:9222'))
  )
);
