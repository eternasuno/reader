import { FeedFetchError, FeedFetcher, FeedParser } from '@reader/business';
import { Effect, Layer } from 'effect';
import { fetchFeed } from '../infrastructure/feed-fetch';

const fetchFailed = () =>
  new FeedFetchError({ error: '无法读取订阅源，请检查地址后重试' });

export const FeedFetcherLive = Layer.effect(
  FeedFetcher,
  Effect.gen(function* () {
    const parser = yield* FeedParser;

    return FeedFetcher.of({
      fetch: (url) =>
        Effect.gen(function* () {
          const document = yield* fetchFeed(url).pipe(
            Effect.timeoutOrElse({
              duration: '10 seconds',
              orElse: () =>
                Effect.fail(
                  new FeedFetchError({ error: '订阅源请求超时，请稍后重试' })
                ),
            }),
            Effect.catchTag('FetchFailure', () => Effect.fail(fetchFailed()))
          );

          const parsed = yield* parser
            .parse(document.content, document.url)
            .pipe(
              Effect.catchTag('FeedParseError', (error) =>
                Effect.fail(new FeedFetchError({ error: error.error }))
              )
            );

          return { ...parsed, url: document.url };
        }),
    });
  })
);
