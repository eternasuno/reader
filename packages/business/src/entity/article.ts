import { Schema } from 'effect';
import { FeedId, OwnerId } from './object-value';

export const ArticleId = Schema.String.pipe(Schema.brand('ArticleId'));

export type ArticleId = typeof ArticleId.Type;

export const Article = Schema.Struct({
  id: ArticleId,
  ownerId: OwnerId,
  feedId: Schema.OptionFromOptional(FeedId),
  url: Schema.OptionFromOptional(Schema.URLFromString),
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  content: Schema.OptionFromOptional(Schema.String),
  extractedContent: Schema.OptionFromOptional(Schema.String),
  publishedAt: Schema.DateTimeUtcFromDate,
  read: Schema.Boolean,
});

export type Article = typeof Article.Type;
