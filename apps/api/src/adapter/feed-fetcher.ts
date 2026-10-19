import { FeedFetchError, FeedFetcher, FeedParser } from '@reader/business';
import { Effect, Layer } from 'effect';
import { fetchFeed } from '../infrastructure/feed-fetch';

export const FeedFetcherLive = Layer.effect(
  FeedFetcher,
  Effect.gen(function* () {
    const parser = yield* FeedParser;

    return FeedFetcher.of({
      fetch: (url) =>
        Effect.tryPromise({
          try: (signal) => fetchFeed(url, signal),
          catch: () =>
            new FeedFetchError({ error: '无法读取订阅源，请检查地址后重试' }),
        }).pipe(
          Effect.timeout('10 seconds'),
          Effect.catchTag('TimeoutError', () =>
            Effect.fail(
              new FeedFetchError({ error: '订阅源请求超时，请稍后重试' })
            )
          ),
          Effect.flatMap((document) =>
            parser.parse(document.content, document.url)
          ),
          Effect.catchTag('FeedParseError', (error) =>
            Effect.fail(new FeedFetchError({ error: error.error }))
          )
        ),
    });
  })
);
