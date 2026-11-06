import {
  Context,
  Data,
  type DateTime,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import { Article, type ArticleId } from '../entity/article';
import { FeedId, type OwnerId } from '../entity/object-value';
import type { ArticleFilter } from './article-pagination';

export { ArticleFilter } from './article-pagination';

export class ArticleRepositoryError extends Data.TaggedError(
  'ArticleRepositoryError'
)<{ readonly message: string }> {}

export type ArticleBoundary = {
  readonly publishedAt: DateTime.Utc;
  readonly id: ArticleId;
};

export type ArticleQuery = {
  readonly filter: ArticleFilter;
  readonly after?: ArticleBoundary;
  readonly through?: ArticleBoundary;
  readonly limit: number;
};

export const ArticlePatch = Article.mapFields((fields) =>
  Struct.map(
    Struct.pick(fields, ['read', 'extractedContent']),
    Schema.optionalKey
  )
);

export type ArticlePatch = typeof ArticlePatch.Type;

export const ArticleUnreadCounts = Schema.Struct({
  later: Schema.Int,
  feedsTotal: Schema.Int,
  feeds: Schema.Array(Schema.Struct({ id: FeedId, count: Schema.Int })),
});

export type ArticleUnreadCounts = typeof ArticleUnreadCounts.Type;

export type IArticleRepository = {
  readonly find: (
    ownerId: OwnerId,
    id: ArticleId
  ) => Effect.Effect<Option.Option<Article>, ArticleRepositoryError>;
  readonly listLater: (
    ownerId: OwnerId,
    query: ArticleQuery
  ) => Effect.Effect<ReadonlyArray<Article>, ArticleRepositoryError>;
  readonly listFeeds: (
    ownerId: OwnerId,
    feedIds: Option.Option<ReadonlyArray<FeedId>>,
    query: ArticleQuery
  ) => Effect.Effect<ReadonlyArray<Article>, ArticleRepositoryError>;
  readonly create: (
    ownerId: OwnerId,
    articles: ReadonlyArray<Article>
  ) => Effect.Effect<ReadonlyArray<ArticleId>, ArticleRepositoryError>;
  readonly updateByArticleIds: (
    ownerId: OwnerId,
    ids: ReadonlyArray<ArticleId>,
    articlePatch: ArticlePatch
  ) => Effect.Effect<ReadonlyArray<ArticleId>, ArticleRepositoryError>;
  readonly updateLater: (
    ownerId: OwnerId,
    articlePatch: ArticlePatch
  ) => Effect.Effect<ReadonlyArray<ArticleId>, ArticleRepositoryError>;
  readonly updateFeeds: (
    ownerId: OwnerId,
    feedIds: Option.Option<ReadonlyArray<FeedId>>,
    articlePatch: ArticlePatch
  ) => Effect.Effect<ReadonlyArray<ArticleId>, ArticleRepositoryError>;
  readonly removeLater: (
    ownerId: OwnerId,
    ids: ReadonlyArray<ArticleId>
  ) => Effect.Effect<void, ArticleRepositoryError>;
  readonly unreadCounts: (
    ownerId: OwnerId
  ) => Effect.Effect<ArticleUnreadCounts, ArticleRepositoryError>;
  readonly inventory: (
    ownerId: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<ReadonlyArray<ArticleBoundary>, ArticleRepositoryError>;
  readonly retain: (
    ownerId: OwnerId,
    feedId: FeedId,
    ids: ReadonlyArray<ArticleId>
  ) => Effect.Effect<void, ArticleRepositoryError>;
};

export class ArticleRepository extends Context.Service<
  ArticleRepository,
  IArticleRepository
>()('reader/ArticleRepository') {}
