import { Context, Data, type Effect, type Option, Schema } from 'effect';
import type { Article } from '../entity/article';
import type { ArticleId, FeedId, OwnerId } from '../entity/object-value';

export class ArticleReadError extends Data.TaggedError('ArticleReadError')<{
  readonly message: string;
}> {}

export class ArticleWriteError extends Data.TaggedError('ArticleWriteError')<{
  readonly message: string;
}> {}

export type ArticleBoundary = {
  readonly publishedAt: string;
  readonly id: ArticleId;
};

export const ArticleFilter = Schema.Literals(['all', 'unread', 'read']);

export type ArticleFilter = typeof ArticleFilter.Type;

export type ArticleQuery = {
  readonly filter: ArticleFilter;
  readonly after?: ArticleBoundary;
  readonly through?: ArticleBoundary;
  readonly limit: number;
};

export interface IArticleRepository {
  readonly find: (
    ownerId: OwnerId,
    id: ArticleId
  ) => Effect.Effect<Option.Option<Article>, ArticleReadError>;
  readonly listLater: (
    ownerId: OwnerId,
    query: ArticleQuery
  ) => Effect.Effect<readonly Article[], ArticleReadError>;
  readonly listFeeds: (
    ownerId: OwnerId,
    feedId: FeedId | undefined,
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

export class ArticleRepository extends Context.Service<
  ArticleRepository,
  IArticleRepository
>()('reader/ArticleRepository') {}
