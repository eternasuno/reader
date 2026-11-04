import { Schema } from 'effect';

export const ArticleSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  feedId: Schema.OptionFromOptional(Schema.String),
  url: Schema.OptionFromOptional(Schema.String),
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  content: Schema.OptionFromOptional(Schema.String),
  extractedContent: Schema.OptionFromOptional(Schema.String),
  publishedAt: Schema.String,
  read: Schema.Boolean,
});

export type Article = typeof ArticleSchema.Type;

export const FeedSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  url: Schema.String,
  title: Schema.String,
  updatedAt: Schema.String,
});

export type Feed = typeof FeedSchema.Type;

export const PreviewSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  titles: Schema.Array(Schema.String),
});

export type Preview = typeof PreviewSchema.Type;

export const ArticlePageSchema = Schema.Struct({
  items: Schema.Array(ArticleSchema),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export const ArticleItemSchema = Schema.Struct({ item: ArticleSchema });
export const ArticleItemsSchema = Schema.Struct({
  items: Schema.Array(ArticleSchema),
});
export const ArticleOrNullItemSchema = Schema.Struct({
  item: Schema.NullOr(ArticleSchema),
});
export const FeedItemSchema = Schema.Struct({ item: FeedSchema });
export const FeedItemsSchema = Schema.Struct({
  items: Schema.Array(FeedSchema),
});
export const PreviewItemSchema = Schema.Struct({ preview: PreviewSchema });
export const UnreadCountsSchema = Schema.Struct({
  later: Schema.Int,
  feedsTotal: Schema.Int,
  feeds: Schema.Array(Schema.Struct({ id: Schema.String, count: Schema.Int })),
});
