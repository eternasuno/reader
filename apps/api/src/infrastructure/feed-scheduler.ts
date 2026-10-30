import { refreshSubscriptions } from '@reader/business';
import { Effect, Layer } from 'effect';
import { FeedFetcherLive } from '../adapter/feed-fetcher';
import { FeedParserLive } from '../adapter/feed-parser';
import { FeedRepositoryLive } from '../adapter/feed-repository';
import { HttpFetchLive } from './http-fetch';

export const FeedSchedulerLive = Layer.effectDiscard(
  refreshSubscriptions.pipe(
    Effect.catch((error) => Effect.logError('Feed scheduler failed', error)),
    Effect.andThen(Effect.sleep('30 minutes')),
    Effect.forever,
    Effect.forkScoped
  )
).pipe(
  Layer.provide(
    Layer.mergeAll(
      FeedRepositoryLive,
      FeedFetcherLive.pipe(Layer.provide(FeedParserLive)),
      HttpFetchLive
    )
  )
);
