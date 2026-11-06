import { Schema, SchemaTransformation } from 'effect';
import {
  FeedId,
  NormalizedUrl,
  OptionFromOptionalNonEmpty,
  OwnerId,
} from './object-value';

export const ArticleId = Schema.String.pipe(Schema.brand('ArticleId'));

export type ArticleId = typeof ArticleId.Type;

export const ArticleTitle = Schema.Trim.pipe(
  Schema.decode(
    SchemaTransformation.transform({
      decode: (title) => title || 'Untitled',
      encode: (title) => title,
    })
  ),
  Schema.brand('ArticleTitle')
);

export type ArticleTitle = typeof ArticleTitle.Type;

export const ArticleDescription = Schema.Trim.pipe(
  Schema.brand('ArticleDescription')
);

export type ArticleDescription = typeof ArticleDescription.Type;

export const ArticleContent = Schema.Trim.pipe(Schema.brand('ArticleContent'));

export type ArticleContent = typeof ArticleContent.Type;

export const Article = Schema.Struct({
  id: ArticleId,
  ownerId: OwnerId,
  feedId: OptionFromOptionalNonEmpty(FeedId),
  url: OptionFromOptionalNonEmpty(NormalizedUrl),
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  extractedContent: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.DateTimeUtcFromDate,
  read: Schema.Boolean,
});

export type Article = typeof Article.Type;
