import { Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../object-value/article';
import { NormalizedUrl } from '../object-value/normalized-url';
import { OptionFromOptionalNonEmpty } from '../object-value/option-from-optional-non-empty';
import { OwnerId } from '../object-value/owner-id';

export const SavedPageId = Schema.String.pipe(Schema.brand('SavedPageId'));

export type SavedPageId = typeof SavedPageId.Type;

export const SavedPage = Schema.Struct({
  id: SavedPageId,
  ownerId: OwnerId,
  url: OptionFromOptionalNonEmpty(NormalizedUrl),
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: ArticleContent,
  publishedAt: Schema.DateTimeUtcFromDate,
  read: Schema.Boolean,
});

export type SavedPage = typeof SavedPage.Type;
