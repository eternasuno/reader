import { expect, it } from '@effect/vitest';
import { FeedFetcher } from '@reader/business';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { FeedFetcherLive } from '../../src/adapter/feed-fetcher';
import { FeedHttpClientLive } from '../../src/infrastructure/feed-http-client';

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel><title>News</title></channel>
</rss>`;

type FetchInit = Parameters<typeof globalThis.fetch>[1];

const fetchFeed = (url: URL) =>
  Effect.flatMap(FeedFetcher, (feedFetcher) => feedFetcher.fetch(url));

const fetchWith = (url: URL, fetchImpl: typeof globalThis.fetch) =>
  fetchFeed(url).pipe(
    Effect.provide(
      Layer.mergeAll(
        FeedFetcherLive.pipe(Layer.provide(FeedHttpClientLive)),
        Layer.succeed(FetchHttpClient.Fetch, fetchImpl)
      )
    )
  );

it.effect('fetches a feed through the configured public client', () =>
  Effect.gen(function* () {
    let init: (FetchInit & { dispatcher?: unknown }) | undefined;
    const fetchImpl = (_input: RequestInfo | URL, options?: FetchInit) => {
      init = options as typeof init;

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    const document = yield* fetchWith(
      new URL('http://8.8.8.8/rss'),
      fetchImpl as typeof globalThis.fetch
    );
    expect(document.content).toBe(rss);
    expect(document.url.href).toBe('http://8.8.8.8/rss');
    expect(init?.redirect).toBe('manual');
    expect(init?.dispatcher).toBeDefined();
  })
);

it.effect('rejects a private target before requesting', () =>
  Effect.gen(function* () {
    let called = false;
    const fetchImpl = () => {
      called = true;

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    const error = yield* Effect.flip(
      fetchWith(
        new URL('http://127.0.0.1/rss'),
        fetchImpl as typeof globalThis.fetch
      )
    );
    expect(error._tag).toBe('FetchFeedError');
    expect(called).toBe(false);
  })
);

it.effect('rejects a redirect to a private target before following', () =>
  Effect.gen(function* () {
    const seen: Array<string> = [];
    const fetchImpl = (input: RequestInfo | URL) => {
      seen.push(String(input));

      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        })
      );
    };
    const error = yield* Effect.flip(
      fetchWith(
        new URL('http://8.8.8.8/rss'),
        fetchImpl as typeof globalThis.fetch
      )
    );
    expect(error._tag).toBe('FetchFeedError');
    expect(seen).toEqual(['http://8.8.8.8/rss']);
  })
);
