import { Schema } from 'effect';
import { ArticleId, FeedId, OwnerId } from './object-value';

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
