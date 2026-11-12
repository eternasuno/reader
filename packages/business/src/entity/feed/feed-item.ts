import { Schema } from 'effect';
import { Model } from 'effect/schema';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../common/article';
import { NormalizedUrl } from '../common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../common/option-from-optional-non-empty';
import { OwnerId } from '../common/owner-id';
import { FeedId } from './feed';

export const FeedItemId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FeedItemId')
);

export type FeedItemId = typeof FeedItemId.Type;

export const FeedItem = Schema.Struct({
  id: Model.UuidV7WithGenerate(FeedItemId),
  ownerId: OwnerId,
  feedId: FeedId,
  url: NormalizedUrl,
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  extractedContent: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  read: Schema.Boolean,
});

export type FeedItem = typeof FeedItem.Type;
