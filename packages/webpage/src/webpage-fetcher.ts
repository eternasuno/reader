import { WebpageFetcher, WebpageFetcherError } from '@reader/business';
import { Context, Effect, Layer, Redacted, Semaphore } from 'effect';
import { endpointTarget, fetchBrowser } from './browser';
import { fetchJina } from './jina';

const BROWSER_CONCURRENCY = 2;

export class BrowserConcurrency extends Context.Service<
  BrowserConcurrency,
  Semaphore.Semaphore
>()('BrowserConcurrency') {}

export const BrowserConcurrencyLive = Layer.effect(
  BrowserConcurrency,
  Semaphore.make(BROWSER_CONCURRENCY)
);

const parseBrowserEndpoint = (
  endpoint: string | URL
): Effect.Effect<Redacted.Redacted<string>, WebpageFetcherError> =>
  Effect.try({
    try: () => {
      endpointTarget(endpoint);

      return Redacted.make(
        typeof endpoint === 'string' ? endpoint : endpoint.href
      );
    },
    catch: () =>
      new WebpageFetcherError({ message: 'Invalid browser service address' }),
  });

const browserTarget = (
  endpoint: string | URL | undefined
): Effect.Effect<Redacted.Redacted<string>, WebpageFetcherError> =>
  endpoint
    ? parseBrowserEndpoint(endpoint)
    : Effect.fail(
        new WebpageFetcherError({
          message: 'Browser service address is required',
        })
      );

export const JinaWebpageFetcherLive = (
  key: Redacted.Redacted<string> | undefined
): Layer.Layer<WebpageFetcher> =>
  Layer.succeed(WebpageFetcher, {
    fetch: (url) =>
      fetchJina(url, key).pipe(
        Effect.mapError(
          (failure) => new WebpageFetcherError({ message: failure.message })
        )
      ),
  });

export const BrowserWebpageFetcherLive = (
  endpoint: string | URL | undefined
): Layer.Layer<WebpageFetcher, never, BrowserConcurrency> =>
  Layer.effect(
    WebpageFetcher,
    Effect.gen(function* () {
      const concurrency = yield* BrowserConcurrency;

      return WebpageFetcher.of({
        fetch: (url) =>
          browserTarget(endpoint).pipe(
            Effect.flatMap((target) => fetchBrowser(url, target)),
            concurrency.withPermit,
            Effect.timeoutOrElse({
              duration: '40 seconds',
              orElse: () =>
                Effect.fail(
                  new WebpageFetcherError({
                    message: 'Browser extraction timed out',
                  })
                ),
            }),
            Effect.catchTag('FetchFailure', () =>
              Effect.fail(
                new WebpageFetcherError({
                  message: 'Browser extraction failed',
                })
              )
            )
          ),
      });
    })
  );
