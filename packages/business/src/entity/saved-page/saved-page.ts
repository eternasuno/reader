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

export const SavedPageId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('SavedPageId')
);

export type SavedPageId = typeof SavedPageId.Type;

export const SavedPage = Schema.Struct({
  id: Model.UuidV7WithGenerate(SavedPageId),
  ownerId: OwnerId,
  url: NormalizedUrl,
  title: ArticleTitle,
  /** Sanitized. */
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  /** Required, non-empty and sanitized. */
  content: ArticleContent,
  /**
   * The article's publish time, if any. Display only; it is the time reported when the page was fetched or saved from a feed item (SP-ADD-4, SP-SAVE-5).
   */
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  /** `false` when created. */
  read: Schema.Boolean,
});

export type SavedPage = typeof SavedPage.Type;
