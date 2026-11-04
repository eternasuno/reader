import { expect, it } from '@effect/vitest';
import {
  OwnerId,
  SettingsRepository,
  SettingsRepositoryError,
  WebpageFetcher,
  WebpageFetcherLayer,
} from '@reader/business';
import { BrowserConcurrency, BrowserConcurrencyLive } from '@reader/webpage';
import { Effect, Layer, Option, Redacted, Semaphore } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { webpageFetcherForOwner } from '../../src/adapter/webpage-fetcher';

const article = 'https://example.com/article';
const html = '<html><body><p>Body</p></body></html>';
const alice = OwnerId.make('alice');
const bob = OwnerId.make('bob');

it.effect('selects each owner key when building a Jina layer', () => {
  const headers: string[] = [];
  const calls: string[] = [];
  const settings = Layer.mock(SettingsRepository, {
    get: (owner) => {
      calls.push(`get:${owner}`);

      return Effect.succeed({
        provider: 'jina',
        retention: 100,
        jinaKey: Option.some(Redacted.make(`${owner}-secret`)),
        browserEndpoint: Option.none(),
      });
    },
  });
  const fetchImpl = (_input: RequestInfo | URL, options?: RequestInit) => {
    headers.push(new Headers(options?.headers).get('authorization') ?? '');

    return Promise.resolve(new Response(html, { status: 200 }));
  };

  return Effect.gen(function* () {
    for (const owner of [alice, bob]) {
      const configured = yield* webpageFetcherForOwner(owner);
      const result = yield* Effect.gen(function* () {
        const layer = yield* WebpageFetcherLayer;

        return yield* Effect.gen(function* () {
          const fetcher = yield* WebpageFetcher;

          return yield* fetcher.fetch(article);
        }).pipe(Effect.provide(layer));
      }).pipe(Effect.provide(configured));
      expect(result).toBe(html);
    }

    expect(headers).toEqual(['Bearer alice-secret', 'Bearer bob-secret']);
    expect(calls).toEqual(['get:alice', 'get:bob']);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        settings,
        BrowserConcurrencyLive,
        Layer.succeed(
          FetchHttpClient.Fetch,
          fetchImpl as typeof globalThis.fetch
        )
      )
    )
  );
});

it.effect('shares browser concurrency across owners', () => {
  const permits: number[] = [];
  const semaphore = Semaphore.makeUnsafe(2);
  const concurrency = Layer.mock(BrowserConcurrency, {
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
  const settings = Layer.mock(SettingsRepository, {
    get: (owner) =>
      Effect.succeed({
        provider: 'browser',
        retention: 100,
        jinaKey: Option.none(),
        browserEndpoint: Option.some(
          owner === alice
            ? ' ftp://127.0.0.1:1 '
            : 'http://user:pass@127.0.0.1:9222'
        ),
      }),
  });

  return Effect.gen(function* () {
    for (const owner of [alice, bob]) {
      const configured = yield* webpageFetcherForOwner(owner);
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const layer = yield* WebpageFetcherLayer;

          return yield* Effect.gen(function* () {
            const fetcher = yield* WebpageFetcher;

            return yield* fetcher.fetch(article);
          }).pipe(Effect.provide(layer));
        }).pipe(Effect.provide(configured))
      );
      expect(error.message).toBe('Invalid browser service address');
    }

    expect(permits).toEqual([1, 1]);
  }).pipe(Effect.provide(Layer.merge(settings, concurrency)));
});

it.effect(
  'propagates settings errors before creating the fetcher layer',
  () => {
    const settings = Layer.mock(SettingsRepository, {
      get: () =>
        Effect.fail(
          new SettingsRepositoryError({ message: 'settings unavailable' })
        ),
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(webpageFetcherForOwner(alice));
      expect(error.message).toBe('settings unavailable');
    }).pipe(Effect.provide(Layer.merge(settings, BrowserConcurrencyLive)));
  }
);
