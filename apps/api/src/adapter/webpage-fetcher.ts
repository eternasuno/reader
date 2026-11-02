import { SettingsRepository, WebpageFetcherFactory } from '@reader/business';
import {
  BrowserConcurrency,
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { Effect, Layer } from 'effect';

export const WebpageFetcherFactoryLive = Layer.effect(
  WebpageFetcherFactory,
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const concurrency = yield* BrowserConcurrency;

    return WebpageFetcherFactory.of({
      forOwner: (owner) =>
        Effect.gen(function* () {
          const config = yield* settings.get(owner);

          if (config.provider === 'jina') {
            const key = yield* settings.getKey(owner);

            return JinaWebpageFetcherLive(key);
          }

          return BrowserWebpageFetcherLive(
            config.browserEndpoint.trim() || undefined
          ).pipe(Layer.provide(Layer.succeed(BrowserConcurrency, concurrency)));
        }),
    });
  })
);
