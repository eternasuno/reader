import { Schema } from 'effect';

export const Feed = Schema.Struct({
  key: Schema.String,
  url: Schema.String,
  title: Schema.String,
  updatedAt: Schema.String,
  error: Schema.String,
  unreadCount: Schema.Number,
});

export type Feed = typeof Feed.Type;

export const FeedArticle = Schema.Struct({
  key: Schema.String,
  feedKey: Schema.String,
  url: Schema.String,
  title: Schema.String,
  publishedAt: Schema.String,
  description: Schema.optional(Schema.String),
  read: Schema.Boolean,
});

export type FeedArticle = typeof FeedArticle.Type;

export const FeedPage = Schema.Struct({
  items: Schema.Array(FeedArticle),
  hasMore: Schema.Boolean,
});

export const ParsedArticle = Schema.Struct({
  identity: Schema.String,
  url: Schema.String,
  title: Schema.String,
  publishedAt: Schema.String,
  description: Schema.optional(Schema.String),
});

export type ParsedArticle = typeof ParsedArticle.Type;

export const ParsedFeed = Schema.Struct({
  title: Schema.String,
  articles: Schema.Array(ParsedArticle),
});

export type ParsedFeed = typeof ParsedFeed.Type;
