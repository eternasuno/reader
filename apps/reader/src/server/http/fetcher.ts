import {
  type ActiveFetcher,
  activeFetcher,
  type OwnerId,
  SettingRepository,
  WebpageFetcher,
} from '@reader/business';
import {
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { Effect, Layer } from 'effect';
import { HttpClient } from 'effect/http';

/**
 * The one implementation a handler chooses (CM-FETCH-2, SET-ACTIVE-1): the
 * provider the owner's setting selects is mapped to its `WebpageFetcher` Layer
 * by exhaustive match, with no condition of its own. This is the only module
 * of the HTTP layer that knows about `@reader/webpage`.
 */
const fetcherLayer = (
  fetcher: ActiveFetcher
): Layer.Layer<WebpageFetcher, never, HttpClient.HttpClient> => {
  switch (fetcher._tag) {
    case 'Jina':
      return JinaWebpageFetcherLive(fetcher.key);
    case 'Browser':
      return BrowserWebpageFetcherLive(fetcher.endpoint);
  }
};

/**
 * Provides the owner's `WebpageFetcher` for one request (CM-FETCH-2). The
 * setting is read inside `fetch`, so a use case that does not fetch never
 * queries `SettingRepository`.
 */
export const webpageFetcherFor = (
  owner: OwnerId
): Layer.Layer<
  WebpageFetcher,
  never,
  SettingRepository | HttpClient.HttpClient
> =>
  Layer.effect(
    WebpageFetcher,
    Effect.gen(function* () {
      const settings = yield* SettingRepository;
      const client = yield* HttpClient.HttpClient;

      return {
        fetch: Effect.fnUntraced(function* (url: string) {
          const setting = yield* settings.get(owner);
          const fetcher = yield* activeFetcher(setting);

          return yield* Effect.flatMap(WebpageFetcher, (delegate) =>
            delegate.fetch(url)
          ).pipe(
            Effect.provide(fetcherLayer(fetcher)),
            Effect.provideService(HttpClient.HttpClient, client)
          );
        }),
      };
    })
  );
