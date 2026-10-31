import { WebpageFetchError, WebpageFetcher } from '@reader/business';
import { Effect, Layer, Redacted, Semaphore } from 'effect';
import { fetchBrowser } from './browser';
import { fetchJina } from './jina';

const browserEndpointProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

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

export const WebpageFetcherLive = Layer.effect(
  WebpageFetcher,
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(2);

    return WebpageFetcher.of({
      fetch: (url, key, provider, endpoint) => {
        if (provider === 'jina') {
          return fetchJina(url, key).pipe(
            Effect.mapError(
              (failure) =>
                new WebpageFetchError({
                  error: failure.message,
                  code: failure.code ?? 'fetch_failed',
                })
            )
          );
        }

        if (!endpoint) {
          return Effect.fail(
            new WebpageFetchError({
              error: 'Browser service address is required',
            })
          );
        }

        return parseBrowserEndpoint(endpoint).pipe(
          Effect.flatMap((target) => fetchBrowser(url, target)),
          semaphore.withPermit,
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
        );
      },
    });
  })
);
