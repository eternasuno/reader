import { Context, type Effect, Schema } from 'effect';
import type { Feed, FeedArticle, ParsedFeed } from '../entity/feed';

export class FeedRepositoryError extends Schema.TaggedError<FeedRepositoryError>()(
  'FeedRepositoryError',
  { cause: Schema.Unknown }
) {}

export class FeedFetchError extends Schema.TaggedError<FeedFetchError>()(
  'FeedFetchError',
  { error: Schema.String }
) {}

export class FeedFetcher extends Context.Service<
  FeedFetcher,
  {
    readonly fetch: (url: string) => Effect.Effect<ParsedFeed, FeedFetchError>;
  }
>()('@reader/business/FeedFetcher') {}

export class FeedRepository extends Context.Service<
  FeedRepository,
  {
    readonly list: (
      owner: string
    ) => Effect.Effect<readonly Feed[], FeedRepositoryError>;
    readonly find: (
      owner: string,
      key: string
    ) => Effect.Effect<Feed | undefined, FeedRepositoryError>;
    readonly create: (
      owner: string,
      url: string,
      title: string
    ) => Effect.Effect<Feed | undefined, FeedRepositoryError>;
    readonly remove: (
      owner: string,
      key: string
    ) => Effect.Effect<boolean, FeedRepositoryError>;
    readonly sync: (
      owner: string,
      key: string,
      feed: ParsedFeed,
      initial: boolean,
      now: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly failure: (
      owner: string,
      key: string,
      message: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly articles: (
      owner: string,
      feedKey: string,
      read: boolean,
      offset: number,
      limit: number
    ) => Effect.Effect<readonly FeedArticle[], FeedRepositoryError>;
    readonly mark: (
      owner: string,
      key: string,
      read: boolean
    ) => Effect.Effect<boolean, FeedRepositoryError>;
    readonly article: (
      owner: string,
      key: string
    ) => Effect.Effect<FeedArticle | undefined, FeedRepositoryError>;
    readonly subscriptions: Effect.Effect<
      readonly { owner: string; key: string }[],
      FeedRepositoryError
    >;
  }
>()('@reader/business/FeedRepository') {}
