import { expect, it } from '@effect/vitest';
import { FeedFetcher } from '@reader/business';
import { Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { FeedFetcherLive } from '../../src/adapter/feed-fetcher';
import { FeedParserLive } from '../../src/adapter/feed-parser';

const rss =
  '<rss version="2.0"><channel><title>News</title><item><guid>one</guid><title>Hello</title><link>https://example.com/a</link></item></channel></rss>';

const FeedLive = FeedFetcherLive.pipe(Layer.provide(FeedParserLive));

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const sequence =
  (...responses: Response[]) =>
  () => {
    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected request');
    }

    return Promise.resolve(response);
  };

it.effect('parses feeds fetched through the pinned client', () =>
  Effect.gen(function* () {
    const fetcher = yield* FeedFetcher;
    const feed = yield* fetcher.fetch('http://8.8.8.8/rss');
    expect(feed.title).toBe('News');
    expect(feed.articles[0]?.url).toBe('https://example.com/a');
  }).pipe(
    provideFetch(
      sequence(new Response(rss, { status: 200 })) as typeof globalThis.fetch
    ),
    Effect.provide(FeedLive)
  )
);

it.effect('converts failed and oversized responses to typed errors', () =>
  Effect.gen(function* () {
    const fetcher = yield* FeedFetcher;
    const failed = yield* Effect.flip(fetcher.fetch('http://8.8.8.8/rss'));
    expect(failed.error).toBe('无法读取订阅源，请检查地址后重试');
    const oversized = yield* Effect.flip(fetcher.fetch('http://8.8.8.8/rss'));
    expect(oversized.error).toBe('无法读取订阅源，请检查地址后重试');
    const encoded = yield* Effect.flip(fetcher.fetch('http://8.8.8.8/rss'));
    expect(encoded.error).toBe('无法读取订阅源，请检查地址后重试');
  }).pipe(
    provideFetch(
      sequence(
        new Response('no', { status: 503 }),
        new Response('a'.repeat(2 * 1024 * 1024 + 1), { status: 200 }),
        new Response(rss, {
          status: 200,
          headers: { 'content-encoding': 'gzip' },
        })
      ) as typeof globalThis.fetch
    ),
    Effect.provide(FeedLive)
  )
);

it.effect('reports a ten second timeout', () =>
  Effect.gen(function* () {
    const fetcher = yield* FeedFetcher;
    const fiber = yield* fetcher
      .fetch('http://8.8.8.8/rss')
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust('10 seconds');
    const error = yield* Fiber.join(fiber).pipe(Effect.flip);
    expect(error.error).toBe('订阅源请求超时，请稍后重试');
  }).pipe(
    provideFetch(
      (() => new Promise<Response>(() => {})) as typeof globalThis.fetch
    ),
    Effect.provide(FeedLive)
  )
);
