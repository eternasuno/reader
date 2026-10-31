import { Context, Data, type Effect, type Option } from 'effect';
import type {
  Article,
  ArticleFilter,
  ArticleId,
  Feed,
  FeedId,
  OwnerId,
} from '../entity/model';

export class ArticleReadError extends Data.TaggedError('ArticleReadError')<{
  readonly message: string;
}> {}

export class ArticleWriteError extends Data.TaggedError('ArticleWriteError')<{
  readonly message: string;
}> {}

export class SubscriptionReadError extends Data.TaggedError(
  'SubscriptionReadError'
)<{ readonly message: string }> {}

export class SubscriptionWriteError extends Data.TaggedError(
  'SubscriptionWriteError'
)<{ readonly message: string }> {}

export type ArticleBoundary = {
  readonly publishedAt: string;
  readonly id: ArticleId;
};

export type ArticleScope =
  | { readonly kind: 'later' }
  | { readonly kind: 'feeds'; readonly feedId?: FeedId };

export type ArticleQuery = {
  readonly scope: ArticleScope;
  readonly filter: ArticleFilter;
  readonly after?: ArticleBoundary;
  readonly through?: ArticleBoundary;
  readonly limit: number;
};

export class Articles extends Context.Service<
  Articles,
  {
    readonly find: (
      ownerId: OwnerId,
      id: ArticleId
    ) => Effect.Effect<Option.Option<Article>, ArticleReadError>;
    readonly list: (
      ownerId: OwnerId,
      query: ArticleQuery
    ) => Effect.Effect<readonly Article[], ArticleReadError>;
    readonly create: (
      ownerId: OwnerId,
      articles: readonly Article[]
    ) => Effect.Effect<readonly ArticleId[], ArticleWriteError>;
    readonly setRead: (
      ownerId: OwnerId,
      ids: readonly ArticleId[],
      read: boolean
    ) => Effect.Effect<void, ArticleWriteError>;
    readonly markLater: (
      ownerId: OwnerId
    ) => Effect.Effect<void, ArticleWriteError>;
    readonly markFeeds: (
      ownerId: OwnerId,
      ids: readonly FeedId[]
    ) => Effect.Effect<void, ArticleWriteError>;
    readonly removeLater: (
      ownerId: OwnerId,
      id: ArticleId
    ) => Effect.Effect<void, ArticleWriteError>;
    readonly saveExtracted: (
      ownerId: OwnerId,
      id: ArticleId,
      content: string
    ) => Effect.Effect<boolean, ArticleWriteError>;
    readonly unreadLater: (
      ownerId: OwnerId
    ) => Effect.Effect<number, ArticleReadError>;
    readonly unreadFeeds: (ownerId: OwnerId) => Effect.Effect<
      {
        readonly total: number;
        readonly feeds: readonly {
          readonly id: FeedId;
          readonly count: number;
        }[];
      },
      ArticleReadError
    >;
    readonly inventory: (
      ownerId: OwnerId,
      feedId: FeedId
    ) => Effect.Effect<readonly ArticleBoundary[], ArticleReadError>;
    readonly retain: (
      ownerId: OwnerId,
      feedId: FeedId,
      ids: readonly ArticleId[]
    ) => Effect.Effect<void, ArticleWriteError>;
  }
>()('reader/Articles') {}

export class Subscriptions extends Context.Service<
  Subscriptions,
  {
    readonly find: (
      ownerId: OwnerId,
      id: FeedId
    ) => Effect.Effect<Option.Option<Feed>, SubscriptionReadError>;
    readonly list: (
      ownerId: OwnerId
    ) => Effect.Effect<readonly Feed[], SubscriptionReadError>;
    readonly create: (
      feed: Feed
    ) => Effect.Effect<boolean, SubscriptionWriteError>;
    readonly remove: (
      ownerId: OwnerId,
      id: FeedId
    ) => Effect.Effect<void, SubscriptionWriteError>;
    readonly update: (
      feed: Feed
    ) => Effect.Effect<void, SubscriptionWriteError>;
    readonly all: Effect.Effect<readonly Feed[], SubscriptionReadError>;
    readonly retention: (
      ownerId: OwnerId
    ) => Effect.Effect<number, SubscriptionReadError>;
    readonly setRetention: (
      ownerId: OwnerId,
      retention: number
    ) => Effect.Effect<void, SubscriptionWriteError>;
  }
>()('reader/Subscriptions') {}
