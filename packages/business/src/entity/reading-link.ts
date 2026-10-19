import { Schema } from 'effect';

export const ReadingLink = Schema.Struct({
  key: Schema.String,
  url: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
  read: Schema.Boolean,
});

export type ReadingLink = typeof ReadingLink.Type;

export const LinkPage = Schema.Struct({
  items: Schema.Array(ReadingLink),
  hasMore: Schema.Boolean,
});

export type LinkPage = typeof LinkPage.Type;
