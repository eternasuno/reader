import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  OwnerId,
  Retention,
  SettingsRepository,
  SettingsRepositoryError,
  WebpageFetcher,
  WebpageFetcherLayer,
} from '@reader/business';
import { BrowserConcurrency, BrowserConcurrencyLive } from '@reader/webpage';
import { Effect, Layer, Option, Redacted, Schema, Semaphore } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { vi } from 'vitest';
import { webpageFetcherForOwner } from '../../src/adapter/webpage-fetcher';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

const article = 'https://example.com/article';

const html = '<html><body><p>Body</p></body></html>';

const alice = OwnerId.make('alice');

const bob = OwnerId.make('bob');

const retention = Schema.decodeSync(Retention);

const browserEndpoint = Schema.decodeSync(BrowserEndpoint);

const discoveryFailure = () =>
  Promise.resolve(new Response(null, { status: 500 }));

it.effect('selects each owner key when building a Jina layer', () => {
  const headers: Array<string> = [];
  const calls: Array<string> = [];
  const settings = Layer.mock(SettingsRepository, {
    get: (owner) => {
      calls.push(`get:${owner}`);

      return Effect.succeed({
        ownerId: owner,
        provider: 'jina',
        retention: retention(100),
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
  const permits: Array<number> = [];
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
        ownerId: owner,
        provider: 'browser',
        retention: retention(100),
        jinaKey: Option.none(),
        browserEndpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
      }),
  });

  vi.stubGlobal('fetch', discoveryFailure);

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
      expect(error.message).toBe('Browser extraction failed');
    }

    expect(permits).toEqual([1, 1]);
  }).pipe(
    Effect.provide(Layer.merge(settings, concurrency)),
    Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))
  );
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
