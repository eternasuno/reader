import { expect, it } from '@effect/vitest';
import {
  type BrowserEndpoint,
  BrowserEndpoint as BrowserEndpointSchema,
  type JinaKey,
  JinaKey as JinaKeySchema,
  WebpageFetcher,
} from '@reader/business';
import { BrowserConcurrency, BrowserConcurrencyLive } from '@reader/webpage';
import { Effect, Layer, Schema, Semaphore } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { vi } from 'vitest';
import {
  browserWebpageFetcherLive,
  jinaWebpageFetcherLive,
} from '../../src/adapter/webpage-fetcher';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

const article = 'https://example.com/article';

const html = '<html><body><p>Body</p></body></html>';

const jinaKey = (value: string): JinaKey =>
  Schema.decodeSync(JinaKeySchema)(value);

const browserEndpoint = (value: string): BrowserEndpoint =>
  Schema.decodeSync(BrowserEndpointSchema)(value);

const discoveryFailure = () =>
  Promise.resolve(new Response(null, { status: 500 }));

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials).toString('base64')}`;

const fetchArticle = Effect.flatMap(WebpageFetcher, (fetcher) =>
  fetcher.fetch(article)
);

const jinaLayer = (key: JinaKey | undefined, impl: typeof globalThis.fetch) =>
  Layer.mergeAll(
    jinaWebpageFetcherLive(key),
    Layer.succeed(FetchHttpClient.Fetch, impl)
  );

const browserLayer = (
  endpoint: BrowserEndpoint | undefined,
  concurrency: Layer.Layer<BrowserConcurrency>
) => browserWebpageFetcherLive(endpoint).pipe(Layer.provide(concurrency));

const browserConcurrencyMock = (permits: Array<number>) => {
  const semaphore = Semaphore.makeUnsafe(2);

  return Layer.mock(BrowserConcurrency, {
    withPermit: <A, E, R>(self: Effect.Effect<A, E, R>) => {
      permits.push(1);

      return semaphore.withPermit(self);
    },
    withPermits:
      (count: number) =>
      <A, E, R>(self: Effect.Effect<A, E, R>) =>
        semaphore.withPermits(count)(self),
    withPermitsIfAvailable:
      (count: number) =>
      <A, E, R>(self: Effect.Effect<A, E, R>) =>
        semaphore.withPermitsIfAvailable(count)(self),
  });
};

it.effect('sends a redacted Jina key as a bearer token', () => {
  let seen: { url: string; headers: Headers } | undefined;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), headers: new Headers(init?.headers) };

    return Promise.resolve(new Response(html, { status: 200 }));
  };

  return Effect.gen(function* () {
    const body = yield* fetchArticle;
    expect(body).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(seen?.headers.get('authorization')).toBe('Bearer alice-secret');
  }).pipe(
    Effect.provide(
      jinaLayer(jinaKey('alice-secret'), fetchImpl as typeof globalThis.fetch)
    )
  );
});

it.effect('omits Jina credentials when no key is configured', () => {
  let headers: Headers | undefined;
  const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) => {
    headers = new Headers(init?.headers);

    return Promise.resolve(new Response(html, { status: 200 }));
  };

  return Effect.gen(function* () {
    yield* fetchArticle;
    expect(headers?.get('authorization')).toBeNull();
  }).pipe(
    Effect.provide(jinaLayer(undefined, fetchImpl as typeof globalThis.fetch))
  );
});

it.effect('uses a shared browser concurrency for the redacted endpoint', () => {
  const permits: Array<number> = [];
  const concurrency = browserConcurrencyMock(permits);

  vi.stubGlobal('fetch', discoveryFailure);

  return Effect.gen(function* () {
    const error = yield* Effect.flip(fetchArticle);
    expect(error.message).toBe('Browser extraction failed');
    expect(permits).toEqual([1]);
  }).pipe(
    Effect.provide(
      browserLayer(browserEndpoint('http://127.0.0.1:9222'), concurrency)
    ),
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
  );
});

it.effect('accepts an endpoint with credentials and sends basic auth', () => {
  let seen: { url: string; authorization: string | null } | undefined;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    seen = {
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    };

    return discoveryFailure();
  };

  vi.stubGlobal('fetch', fetchImpl);

  return Effect.gen(function* () {
    const error = yield* Effect.flip(fetchArticle);
    expect(error.message).toBe('Browser extraction failed');
    expect(seen?.url).toBe('http://127.0.0.1:9222/json/version');
    expect(seen?.authorization).toBe(basic('alice:secret'));
  }).pipe(
    Effect.provide(
      browserLayer(
        browserEndpoint('http://alice:secret@127.0.0.1:9222'),
        BrowserConcurrencyLive
      )
    ),
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
  );
});

it.effect('requires a browser endpoint instead of a default', () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected request');
  });

  return Effect.gen(function* () {
    const error = yield* Effect.flip(fetchArticle);
    expect(error._tag).toBe('WebpageFetcherError');
    expect(error.message).toBe('Browser service address is required');
  }).pipe(
    Effect.provide(browserLayer(undefined, BrowserConcurrencyLive)),
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
  );
});
