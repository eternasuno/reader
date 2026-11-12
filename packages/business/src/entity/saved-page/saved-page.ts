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
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: ArticleContent,
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
  read: Schema.Boolean,
});

export type SavedPage = typeof SavedPage.Type;
