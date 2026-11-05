import {
  type OwnerId,
  SettingsRepository,
  WebpageFetcherLayer,
} from '@reader/business';
import {
  BrowserConcurrency,
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { Effect, Layer, Option } from 'effect';

export const webpageFetcherForOwner = (owner: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const config = yield* settings.get(owner);
    const concurrency = yield* BrowserConcurrency;

    if (config.provider === 'jina') {
      return Layer.succeed(
        WebpageFetcherLayer,
        JinaWebpageFetcherLive(Option.getOrUndefined(config.jinaKey))
      );
    }

    const layer = BrowserWebpageFetcherLive(
      Option.getOrUndefined(config.browserEndpoint)
    ).pipe(Layer.provide(Layer.succeed(BrowserConcurrency, concurrency)));

    return Layer.succeed(WebpageFetcherLayer, layer);
  });
