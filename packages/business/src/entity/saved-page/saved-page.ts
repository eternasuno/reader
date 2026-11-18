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

/** A lower-case version-7 UUID (CM-ID); decoding rejects anything else. */
export const SavedPageId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('SavedPageId')
);

export type SavedPageId = typeof SavedPageId.Type;

/**
 * One page of the read-later list. One page per `(ownerId, url)`, however many
 * owners save the URL (CM-ID-6, SP-ID-2).
 */
export const SavedPage = Schema.Struct({
  /** Made when the page is created (CM-ID-3, SP-ID-1). */
  id: Model.UuidV7WithGenerate(SavedPageId),
  ownerId: OwnerId,
  url: NormalizedUrl,
  title: ArticleTitle,
  /** Sanitized; none when absent or blank (CM-ART-3, CM-ART-4). */
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  /**
   * Required: adding a link stores the extracted article or fails, while a
   * feed item may arrive with no text (CM-ART-4).
   */
  content: ArticleContent,
  /**
   * The article's publish time when it has one; display only (SP-ADD-4,
   * SP-SAVE-5, CM-FETCH-1).
   */
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  /** `false` when created (SP-ADD step 3, SP-SAVE-9). */
  read: Schema.Boolean,
});

export type SavedPage = typeof SavedPage.Type;
