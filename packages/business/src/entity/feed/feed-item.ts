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
  /** Items carry their owner, so no operation has to look up the feed. */
  ownerId: OwnerId,
  feedId: FeedId,
  /**
   * One item per feed for a URL (FD-ID-2); the parser drops entries without
   * one, so every stored item has a URL.
   */
  url: NormalizedUrl,
  title: ArticleTitle,
  /** Sanitized before storage (FD-IMPORT-2). */
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  /** Sanitized before storage (FD-IMPORT-2). */
  content: OptionFromOptionalNonEmpty(ArticleContent),
  /** Filled on demand (FD-EXTRACT); none when the item is imported. */
  extractedContent: OptionFromOptionalNonEmpty(ArticleContent),
  /**
   * Display-only; takes no part in ordering, retention or paging
   * (FD-IMPORT-5).
   */
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  /** `false` when the item is imported (FD-IMPORT-1). */
  read: Schema.Boolean,
});

export type FeedItem = typeof FeedItem.Type;
