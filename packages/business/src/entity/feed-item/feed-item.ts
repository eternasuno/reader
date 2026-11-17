import { Schema } from 'effect';
import { Model } from 'effect/schema';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../common/article';
import { NormalizedUrl } from '../common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../common/optional';
import { OwnerId } from '../common/owner-id';
import { FeedId } from '../feed/feed';

/** A lower-case version-7 UUID (CM-ID); decoding rejects anything else. */
export const FeedItemId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FeedItemId')
);

export type FeedItemId = typeof FeedItemId.Type;

/**
 * One stored entry of a feed. One item per `(feedId, url)`; the same URL in two
 * feeds is two items (CM-ID-6, FD-ID-2, FD-ID-3).
 */
export const FeedItem = Schema.Struct({
  /** Made when the item is imported (CM-ID-3, FD-SEL-9). */
  id: Model.UuidV7WithGenerate(FeedItemId),
  /** Items carry their owner, so no operation has to look up the feed (FD-OPEN-3). */
  ownerId: OwnerId,
  feedId: FeedId,
  /** The parser drops entries without one, so every stored item has a URL (FD-IMPORT-7). */
  url: NormalizedUrl,
  title: ArticleTitle,
  /** Sanitized before storage; none when the source gave none (CM-ART-4, FD-IMPORT-3). */
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  /** Sanitized before storage; none when the source gave none (CM-ART-4, FD-IMPORT-3). */
  content: OptionFromOptionalNonEmpty(ArticleContent),
  /** Filled on demand; none when the item is imported (FD-EXTRACT). */
  extractedContent: OptionFromOptionalNonEmpty(ArticleContent),
  /**
   * Display only: it takes no part in ordering, retention or paging
   * (FD-IMPORT-5).
   */
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  /** `false` when the item is imported (FD-IMPORT-1). */
  read: Schema.Boolean,
});

export type FeedItem = typeof FeedItem.Type;
