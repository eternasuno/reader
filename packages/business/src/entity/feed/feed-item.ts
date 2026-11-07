import { Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../object-value/article';
import { NormalizedUrl } from '../object-value/normalized-url';
import { OptionFromOptionalNonEmpty } from '../object-value/option-from-optional-non-empty';
import { FeedId } from './feed';

export const FeedItemId = Schema.String.pipe(Schema.brand('FeedItemId'));

export type FeedItemId = typeof FeedItemId.Type;

export const FeedItem = Schema.Struct({
  id: FeedItemId,
  feedId: FeedId,
  url: OptionFromOptionalNonEmpty(NormalizedUrl),
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  extractedContent: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.DateTimeUtcFromDate,
  read: Schema.Boolean,
});

export type FeedItem = typeof FeedItem.Type;
