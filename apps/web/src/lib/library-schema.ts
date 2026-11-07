import { Schema } from 'effect';

export const FeedItemSchema = Schema.Struct({
  id: Schema.String,
  feedId: Schema.String,
  url: Schema.OptionFromOptional(Schema.String),
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  content: Schema.OptionFromOptional(Schema.String),
  extractedContent: Schema.OptionFromOptional(Schema.String),
  publishedAt: Schema.String,
  read: Schema.Boolean,
});

export type FeedItem = typeof FeedItemSchema.Type;

export const SavedPageSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  url: Schema.OptionFromOptional(Schema.String),
  title: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  content: Schema.String,
  publishedAt: Schema.String,
  read: Schema.Boolean,
});

export type SavedPage = typeof SavedPageSchema.Type;

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

const page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    items: Schema.Array(item),
    cursor: Schema.NullOr(Schema.String),
    boundary: Schema.NullOr(Schema.String),
  });

export const FeedItemPageSchema = page(FeedItemSchema);

export const SavedPagePageSchema = page(SavedPageSchema);

export const FeedItemResponseSchema = Schema.Struct({ item: FeedItemSchema });

export const FeedItemsResponseSchema = Schema.Struct({
  items: Schema.Array(FeedItemSchema),
});

export const FeedItemOrNullResponseSchema = Schema.Struct({
  item: Schema.NullOr(FeedItemSchema),
});

export const SavedPageResponseSchema = Schema.Struct({ item: SavedPageSchema });

export const SavedPagesResponseSchema = Schema.Struct({
  items: Schema.Array(SavedPageSchema),
});

export const SavedPageOrNullResponseSchema = Schema.Struct({
  item: Schema.NullOr(SavedPageSchema),
});

export const FeedResponseSchema = Schema.Struct({ item: FeedSchema });

export const FeedsResponseSchema = Schema.Struct({
  items: Schema.Array(FeedSchema),
});

export const PreviewResponseSchema = Schema.Struct({ preview: PreviewSchema });

export const UnreadCountsSchema = Schema.Struct({
  saved: Schema.Int,
  feedsTotal: Schema.Int,
  feeds: Schema.Array(Schema.Struct({ id: Schema.String, count: Schema.Int })),
});

export type UnreadCounts = typeof UnreadCountsSchema.Type;
