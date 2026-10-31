import { Schema } from 'effect';

export const OwnerId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand('OwnerId')
);

export type OwnerId = typeof OwnerId.Type;

export const FeedId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/)
).pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;

export const ArticleId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/)
).pipe(Schema.brand('ArticleId'));

export type ArticleId = typeof ArticleId.Type;

export const Article = Schema.Struct({
  id: ArticleId,
  ownerId: OwnerId,
  feedId: Schema.optional(FeedId),
  url: Schema.optional(Schema.URLFromString),
  title: Schema.String,
  description: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  extractedContent: Schema.optional(Schema.String),
  publishedAt: Schema.DateTimeUtcFromString,
  read: Schema.Boolean,
});

export type Article = typeof Article.Type;

export const Feed = Schema.Struct({
  id: FeedId,
  ownerId: OwnerId,
  url: Schema.URLFromString,
  title: Schema.String,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type Feed = typeof Feed.Type;

export const ArticleFilter = Schema.Literals(['all', 'unread', 'read']);

export type ArticleFilter = typeof ArticleFilter.Type;

export const ArticlePage = Schema.Struct({
  items: Schema.Array(Article),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export type ArticlePage = typeof ArticlePage.Type;

export const SubscriptionPreview = Schema.Struct({
  url: Schema.URLFromString,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  titles: Schema.Array(Schema.String),
});

export const Retention = Schema.Int.check(
  Schema.isBetween({ minimum: 30, maximum: 300 })
);

export const ReadingSettings = Schema.Struct({
  retention: Retention,
  provider: Schema.Literals(['jina', 'browser']),
  jinaConfigured: Schema.Boolean,
  browserEndpoint: Schema.String,
});
