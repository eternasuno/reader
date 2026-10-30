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

export type PendingFeedPreview = {
  readonly owner: string;
  readonly url: string;
  readonly feed: ParsedFeed;
  readonly expiresAt: number;
};

export class FeedPreviewStore extends Context.Service<
  FeedPreviewStore,
  {
    readonly save: (
      preview: PendingFeedPreview,
      now: number
    ) => Effect.Effect<string, FeedFetchError>;
    readonly find: (
      owner: string,
      token: string,
      now: number
    ) => Effect.Effect<PendingFeedPreview | undefined>;
  }
>()('@reader/business/FeedPreviewStore') {}

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
    readonly createSubscribed: (
      owner: string,
      url: string,
      feed: ParsedFeed,
      now: string
    ) => Effect.Effect<Feed, FeedRepositoryError>;
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
      limit: number,
      all?: boolean,
      before?: string,
      beforeKey?: string
    ) => Effect.Effect<readonly FeedArticle[], FeedRepositoryError>;
    readonly mark: (
      owner: string,
      key: string,
      read: boolean
    ) => Effect.Effect<boolean, FeedRepositoryError>;
    readonly markAll: (
      owner: string,
      feedKey: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly markLoaded: (
      owner: string,
      keys: readonly string[]
    ) => Effect.Effect<void, FeedRepositoryError>;
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
