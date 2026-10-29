import { Schema } from 'effect';

export const ArticleSource = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  read: Schema.Boolean,
  description: Schema.optional(Schema.String),
  feedKey: Schema.optional(Schema.String),
});

export type ArticleSource = typeof ArticleSource.Type;

export const ArticleContent = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  html: Schema.String,
  extractedAt: Schema.String,
});

export type ArticleContent = typeof ArticleContent.Type;
