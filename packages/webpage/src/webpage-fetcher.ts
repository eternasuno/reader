import { WebpageFetchError, WebpageFetcher } from '@reader/business';
import { Context, Effect, Layer, Redacted, Semaphore } from 'effect';
import { fetchBrowser } from './browser';
import { fetchJina } from './jina';

const BROWSER_CONCURRENCY = 2;

const browserEndpointProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

export class BrowserConcurrency extends Context.Service<
  BrowserConcurrency,
  Semaphore.Semaphore
>()('BrowserConcurrency') {}

export const BrowserConcurrencyLive = Layer.effect(
  BrowserConcurrency,
  Semaphore.make(BROWSER_CONCURRENCY)
);

const parseBrowserEndpoint = (
  endpoint: string
): Effect.Effect<Redacted.Redacted<string>, WebpageFetchError> =>
  Effect.try({
    try: () => {
      const url = new URL(endpoint);
      if (
        !browserEndpointProtocols.has(url.protocol) ||
        url.username ||
        url.password ||
        endpoint.includes('#')
      ) {
        throw new Error('Unsupported browser endpoint');
      }

      return Redacted.make(endpoint);
    },
    catch: () =>
      new WebpageFetchError({ error: 'Invalid browser service address' }),
  });

const browserTarget = (
  endpoint: string | undefined
): Effect.Effect<Redacted.Redacted<string>, WebpageFetchError> =>
  endpoint
    ? parseBrowserEndpoint(endpoint)
    : Effect.fail(
        new WebpageFetchError({
          error: 'Browser service address is required',
        })
      );

export const JinaWebpageFetcherLive = (
  key: Redacted.Redacted<string> | undefined
): Layer.Layer<WebpageFetcher> =>
  Layer.succeed(WebpageFetcher, {
    fetch: (url) =>
      fetchJina(url, key).pipe(
        Effect.mapError(
          (failure) =>
            new WebpageFetchError({
              error: failure.message,
              code: failure.code ?? 'fetch_failed',
            })
        )
      ),
  });

export const BrowserWebpageFetcherLive = (
  endpoint: string | undefined
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
                  new WebpageFetchError({
                    error: 'Browser extraction timed out',
                    code: 'fetch_failed',
                  })
                ),
            }),
            Effect.catchTag('FetchFailure', () =>
              Effect.fail(
                new WebpageFetchError({
                  error: 'Browser extraction failed',
                  code: 'fetch_failed',
                })
              )
            )
          ),
      });
    })
  );
