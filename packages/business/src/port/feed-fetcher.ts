import { Context, Data, type Effect } from 'effect';
import type { ParsedFeed } from '../entity/feed';

export class FeedFetchError extends Data.TaggedError('FeedFetchError')<{
  readonly error: string;
}> {}

export class FeedFetcher extends Context.Service<
  FeedFetcher,
  {
    readonly fetch: (url: string) => Effect.Effect<ParsedFeed, FeedFetchError>;
  }
>()('@reader/business/FeedFetcher') {}
