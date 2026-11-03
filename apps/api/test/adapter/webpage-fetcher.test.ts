import { expect, it } from '@effect/vitest';
import {
  OwnerId,
  SettingsRepository,
  SettingsRepositoryError,
  WebpageFetcher,
  WebpageFetcherFactory,
} from '@reader/business';
import { BrowserConcurrency, BrowserConcurrencyLive } from '@reader/webpage';
import { Effect, Layer, Option, Redacted, Schema, Semaphore } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { WebpageFetcherFactoryLive } from '../../src/adapter/webpage-fetcher';

const alice = Schema.decodeSync(OwnerId)('alice');
const bob = Schema.decodeSync(OwnerId)('bob');
const carol = Schema.decodeSync(OwnerId)('carol');
const article = 'https://example.com/article';
const html = '<html><body><p>Body</p></body></html>';

type SettingsFixture = {
  readonly provider: 'jina' | 'browser';
  readonly key?: Redacted.Redacted<string>;
  readonly browserEndpoint?: string;
};

const settingsLayer = (
  fixtures: Readonly<Record<string, SettingsFixture>>,
  calls: string[]
) =>
  Layer.mock(SettingsRepository, {
    get: (owner) => {
      calls.push(`get:${owner}`);
      const fixture = fixtures[owner];

      return Effect.succeed({
        retention: 100,
        provider: fixture?.provider ?? 'jina',
        jinaConfigured: fixture?.key !== undefined,
        browserEndpoint: Option.fromUndefinedOr(fixture?.browserEndpoint),
      });
    },
    getKey: (owner) => {
      calls.push(`getKey:${owner}`);

      return Effect.succeed(Option.fromUndefinedOr(fixtures[owner]?.key));
    },
  });

const trackedConcurrency = (permits: number[]) => {
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

const runFetcher = (owner: OwnerId) =>
  Effect.gen(function* () {
    const factory = yield* WebpageFetcherFactory;
    const layer = yield* factory.forOwner(owner);

    return yield* Effect.gen(function* () {
      const fetcher = yield* WebpageFetcher;

      return yield* fetcher.fetch(article);
    }).pipe(Effect.provide(layer));
  });

it.effect('selects the Jina fetcher with only the owner key', () => {
  const calls: string[] = [];
  let init: RequestInit | undefined;
  const fetchImpl = (_input: RequestInfo | URL, options?: RequestInit) => {
    init = options;

    return Promise.resolve(new Response(html, { status: 200 }));
  };

  return Effect.gen(function* () {
    const result = yield* runFetcher(alice);
    expect(result).toBe(html);
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer alice-secret'
    );
    expect(calls).toEqual([`get:${alice}`, `getKey:${alice}`]);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        WebpageFetcherFactoryLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              settingsLayer(
                {
                  [alice]: {
                    provider: 'jina',
                    key: Redacted.make('alice-secret'),
                  },
                },
                calls
              ),
              BrowserConcurrencyLive
            )
          )
        ),
        Layer.succeed(
          FetchHttpClient.Fetch,
          fetchImpl as typeof globalThis.fetch
        )
      )
    )
  );
});

it.effect('selects the browser fetcher without reading the key', () => {
  const calls: string[] = [];
  const permits: number[] = [];

  return Effect.gen(function* () {
    const error = yield* Effect.flip(runFetcher(bob));
    expect(error._tag).toBe('WebpageFetchError');
    expect(error.error).toBe('Invalid browser service address');
    expect(calls).toEqual([`get:${bob}`]);
    expect(permits).toEqual([1]);
  }).pipe(
    Effect.provide(
      WebpageFetcherFactoryLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            settingsLayer(
              {
                [bob]: {
                  provider: 'browser',
                  key: Redacted.make('unused-secret'),
                  browserEndpoint: 'ftp://127.0.0.1:9222',
                },
              },
              calls
            ),
            trackedConcurrency(permits)
          )
        )
      )
    )
  );
});

it.effect('shares one browser concurrency across owner layers', () => {
  const permits: number[] = [];

  return Effect.gen(function* () {
    yield* Effect.flip(runFetcher(bob));
    yield* Effect.flip(runFetcher(carol));
    expect(permits).toEqual([1, 1]);
  }).pipe(
    Effect.provide(
      WebpageFetcherFactoryLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            settingsLayer(
              {
                [bob]: {
                  provider: 'browser',
                  browserEndpoint: 'ftp://127.0.0.1:1',
                },
                [carol]: {
                  provider: 'browser',
                  browserEndpoint: 'http://user:pass@127.0.0.1:9222',
                },
              },
              []
            ),
            trackedConcurrency(permits)
          )
        )
      )
    )
  );
});

it.effect('reports settings repository failures from owner selection', () => {
  const failing = Layer.mock(SettingsRepository, {
    get: () =>
      Effect.fail(
        new SettingsRepositoryError({
          error: 'Failed to access extraction settings',
        })
      ),
  });

  return Effect.gen(function* () {
    const factory = yield* WebpageFetcherFactory;
    const error = yield* Effect.flip(factory.forOwner(alice));
    expect(error._tag).toBe('SettingsRepositoryError');
    expect(error.error).toBe('Failed to access extraction settings');
  }).pipe(
    Effect.provide(
      WebpageFetcherFactoryLive.pipe(
        Layer.provide(Layer.mergeAll(failing, BrowserConcurrencyLive))
      )
    )
  );
});
