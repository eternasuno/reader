import { Context, Data, type Effect, type Option, Schema } from 'effect';
import type { Article, ArticleId } from '../entity/article';
import type { FeedId, OwnerId } from '../entity/object-value';

export class ArticleRepositoryError extends Data.TaggedError(
  'ArticleRepositoryError'
)<{ readonly message: string }> {}

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
  ) => Effect.Effect<Option.Option<Article>, ArticleRepositoryError>;
  readonly listLater: (
    ownerId: OwnerId,
    query: ArticleQuery
  ) => Effect.Effect<readonly Article[], ArticleRepositoryError>;
  readonly listFeeds: (
    ownerId: OwnerId,
    feedId: FeedId | undefined,
    query: ArticleQuery
  ) => Effect.Effect<readonly Article[], ArticleRepositoryError>;
  readonly create: (
    ownerId: OwnerId,
    articles: readonly Article[]
  ) => Effect.Effect<readonly ArticleId[], ArticleRepositoryError>;
  readonly setRead: (
    ownerId: OwnerId,
    ids: readonly ArticleId[],
    read: boolean
  ) => Effect.Effect<void, ArticleRepositoryError>;
  readonly markLater: (
    ownerId: OwnerId
  ) => Effect.Effect<void, ArticleRepositoryError>;
  readonly markFeeds: (
    ownerId: OwnerId,
    ids: readonly FeedId[]
  ) => Effect.Effect<void, ArticleRepositoryError>;
  readonly removeLater: (
    ownerId: OwnerId,
    id: ArticleId
  ) => Effect.Effect<void, ArticleRepositoryError>;
  readonly saveExtracted: (
    ownerId: OwnerId,
    id: ArticleId,
    content: string
  ) => Effect.Effect<boolean, ArticleRepositoryError>;
  readonly unreadLater: (
    ownerId: OwnerId
  ) => Effect.Effect<number, ArticleRepositoryError>;
  readonly unreadFeeds: (ownerId: OwnerId) => Effect.Effect<
    {
      readonly total: number;
      readonly feeds: readonly {
        readonly id: FeedId;
        readonly count: number;
      }[];
    },
    ArticleRepositoryError
  >;
  readonly inventory: (
    ownerId: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<readonly ArticleBoundary[], ArticleRepositoryError>;
  readonly retain: (
    ownerId: OwnerId,
    feedId: FeedId,
    ids: readonly ArticleId[]
  ) => Effect.Effect<void, ArticleRepositoryError>;
}

export class ArticleRepository extends Context.Service<
  ArticleRepository,
  IArticleRepository
>()('reader/ArticleRepository') {}
