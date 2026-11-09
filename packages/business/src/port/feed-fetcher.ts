import { Context, Data, type Effect } from 'effect';

export type FeedDocument = {
  readonly content: string;
  readonly url: URL;
};

export class FetchFeedError extends Data.TaggedError('FetchFeedError')<{
  readonly message: string;
}> {}

export interface IFeedFetcher {
  readonly fetch: (url: URL) => Effect.Effect<FeedDocument, FetchFeedError>;
}

export class FeedFetcher extends Context.Service<FeedFetcher, IFeedFetcher>()(
  '@reader/business/FeedFetcher'
) {}
