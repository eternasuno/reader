import { expect, it } from '@effect/vitest';
import {
  type BrowserEndpoint,
  BrowserEndpoint as BrowserEndpointSchema,
  OwnerId,
  Retention,
  type Setting,
  SettingsRepository,
  SettingsRepositoryError,
  WebpageFetcher,
} from '@reader/business';
import { BrowserConcurrency, BrowserConcurrencyLive } from '@reader/webpage';
import { Effect, Layer, Option, Redacted, Schema, Semaphore } from 'effect';
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

const alice = OwnerId.make('alice');

const bob = OwnerId.make('bob');

const retention = Schema.decodeSync(Retention);

const browserEndpoint = Schema.decodeSync(BrowserEndpointSchema);

const browserEndpointOf = (config: Setting): BrowserEndpoint => {
  if (config.fetcher.provider !== 'browser') {
    throw new Error('Expected a browser fetcher setting');
  }

  return Option.getOrThrow(config.fetcher.browser.endpoint);
};

const discoveryFailure = () =>
  Promise.resolve(new Response(null, { status: 500 }));

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

it.effect('selects each owner key when building a Jina layer', () => {
  const headers: Array<string> = [];
  const calls: Array<string> = [];
  const settings = Layer.mock(SettingsRepository, {
    get: (owner) => {
      calls.push(`get:${owner}`);

      return Effect.succeed({
        ownerId: owner,
        feed: { retention: retention(100) },
        fetcher: {
          provider: 'jina' as const,
          jina: { key: Option.some(Redacted.make(`${owner}-secret`)) },
          browser: { endpoint: Option.none() },
        },
      });
    },
  });
  const fetchImpl = (_input: RequestInfo | URL, options?: RequestInit) => {
    headers.push(new Headers(options?.headers).get('authorization') ?? '');

    return Promise.resolve(new Response(html, { status: 200 }));
  };

  return Effect.gen(function* () {
    for (const owner of [alice, bob]) {
      const settingsRepository = yield* SettingsRepository;
      const config = yield* settingsRepository.get(owner);
      const configured = jinaWebpageFetcherLive(
        Option.getOrUndefined(config.fetcher.jina.key)
      );
      const result = yield* Effect.gen(function* () {
        const fetcher = yield* WebpageFetcher;

        return yield* fetcher.fetch(article);
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
  const concurrency = browserConcurrencyMock(permits);
  const settings = Layer.mock(SettingsRepository, {
    get: (owner) =>
      Effect.succeed({
        ownerId: owner,
        feed: { retention: retention(100) },
        fetcher: {
          provider: 'browser' as const,
          jina: { key: Option.none() },
          browser: {
            endpoint: Option.some(browserEndpoint('http://127.0.0.1:9222')),
          },
        },
      }),
  });

  vi.stubGlobal('fetch', discoveryFailure);

  return Effect.gen(function* () {
    for (const owner of [alice, bob]) {
      const settingsRepository = yield* SettingsRepository;
      const config = yield* settingsRepository.get(owner);
      const configured = browserWebpageFetcherLive(browserEndpointOf(config));
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const fetcher = yield* WebpageFetcher;

          return yield* fetcher.fetch(article);
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
      const settingsRepository = yield* SettingsRepository;
      const error = yield* Effect.flip(settingsRepository.get(alice));
      expect(error.message).toBe('settings unavailable');
    }).pipe(Effect.provide(settings));
  }
);
