import { expect, it } from '@effect/vitest';
import { WebpageFetcher } from '@reader/business';
import { ConfigProvider, Effect, Fiber, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { WebpageFetcherLive } from '../src';

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
      .fetch(article, key, 'jina')
      .pipe(provideFetch(fetchImpl as typeof globalThis.fetch));
    const headers = new Headers(seen?.init?.headers);
    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(seen?.init?.redirect).toBe('error');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('x-return-format')).toBe('html');
  }).pipe(Effect.provide(WebpageFetcherLive))
);

it.effect('rejects credentialed or unsupported addresses before fetching', () =>
  Effect.gen(function* () {
    const fetchImpl = () => {
      throw new Error('Unexpected request');
    };
    const fetcher = yield* WebpageFetcher;
    const credentialed = yield* Effect.flip(
      fetcher
        .fetch('https://user:pass@example.com/a', key, 'jina')
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );
    const unsupported = yield* Effect.flip(
      fetcher
        .fetch('ftp://example.com/a', key, 'jina')
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );
    expect(credentialed._tag).toBe('WebpageFetchError');
    expect(unsupported._tag).toBe('WebpageFetchError');
  }).pipe(Effect.provide(WebpageFetcherLive))
);

it.effect('rejects redirects, oversized bodies and failed statuses', () =>
  Effect.gen(function* () {
    const responses = [
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example/' },
      }),
      new Response('a'.repeat(5 * 1024 * 1024 + 1), { status: 200 }),
      new Response('no', { status: 502 }),
    ];
    const fetchImpl = () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }

      return Promise.resolve(response);
    };
    const fetcher = yield* WebpageFetcher;
    const redirect = yield* Effect.flip(
      fetcher
        .fetch(article, key, 'jina')
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );
    const oversized = yield* Effect.flip(
      fetcher
        .fetch(article, key, 'jina')
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );
    const failed = yield* Effect.flip(
      fetcher
        .fetch(article, key, 'jina')
        .pipe(provideFetch(fetchImpl as typeof globalThis.fetch))
    );
    expect(redirect._tag).toBe('WebpageFetchError');
    expect(oversized._tag).toBe('WebpageFetchError');
    expect(failed._tag).toBe('WebpageFetchError');
  }).pipe(Effect.provide(WebpageFetcherLive))
);

it.effect('requires a browser endpoint instead of an environment default', () =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const error = yield* Effect.flip(
      fetcher.fetch(article, undefined, 'browser')
    );
    expect(error._tag).toBe('WebpageFetchError');
    expect(error.error).toBe('请先在设置中填写浏览器服务地址');
  }).pipe(
    Effect.provide(
      Layer.merge(
        WebpageFetcherLive,
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
    const fetcher = yield* WebpageFetcher;
    const endpoints = [
      'ftp://127.0.0.1:9222',
      'http://user:secret@127.0.0.1:9222',
      'http://127.0.0.1:9222/#devtools',
    ];

    for (const endpoint of endpoints) {
      const error = yield* Effect.flip(
        fetcher.fetch(article, undefined, 'browser', endpoint)
      );
      expect(error._tag).toBe('WebpageFetchError');
      expect(error.error).toBe('浏览器服务地址无效，请检查设置');
    }
  }).pipe(Effect.provide(WebpageFetcherLive))
);

it.effect('reports a forty second timeout', () =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const fiber = yield* fetcher
      .fetch(article, key, 'jina')
      .pipe(
        provideFetch(
          (() => new Promise<Response>(() => {})) as typeof globalThis.fetch
        ),
        Effect.forkChild
      );
    yield* Effect.yieldNow;
    yield* TestClock.adjust('40 seconds');
    const error = yield* Fiber.join(fiber).pipe(Effect.flip);
    expect(error.error).toBe('获取正文超时，请稍后重试');
  }).pipe(Effect.provide(WebpageFetcherLive))
);
