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
      new WebpageFetchError({ error: '浏览器服务地址无效，请检查设置' }),
  });

export const WebpageFetcherLive = Layer.effect(
  WebpageFetcher,
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(2);

    return WebpageFetcher.of({
      fetch: (url, key, provider, endpoint) => {
        if (provider === 'jina') {
          if (!key) {
            return Effect.fail(
              new WebpageFetchError({ error: '请先在设置中填写 Jina API Key' })
            );
          }

          return fetchJina(url, key).pipe(
            Effect.mapError(
              (failure) =>
                new WebpageFetchError({
                  error:
                    failure.message === 'Jina request timed out'
                      ? '获取正文超时，请稍后重试'
                      : 'Jina 获取失败，请检查 Key、额度及文章地址',
                })
            )
          );
        }

        if (!endpoint) {
          return Effect.fail(
            new WebpageFetchError({ error: '请先在设置中填写浏览器服务地址' })
          );
        }

        return parseBrowserEndpoint(endpoint).pipe(
          Effect.flatMap((target) => fetchBrowser(url, target)),
          semaphore.withPermit,
          Effect.timeoutOrElse({
            duration: '40 seconds',
            orElse: () =>
              Effect.fail(
                new WebpageFetchError({ error: '浏览器提取超时，请稍后重试' })
              ),
          }),
          Effect.catchTag('FetchFailure', () =>
            Effect.fail(
              new WebpageFetchError({
                error: '浏览器获取失败，请检查服务器浏览器服务及文章地址',
              })
            )
          )
        );
      },
    });
  })
);
