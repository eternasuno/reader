import { Context, Data, type Effect, Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../entity/common/article';
import { OptionFromOptionalNonEmpty } from '../entity/common/option-from-optional-non-empty';

export class ArticleExtractorError extends Data.TaggedError(
  'ArticleExtractorError'
)<{
  readonly message: string;
}> {}

export const ExtractedArticle = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type ExtractedArticle = typeof ExtractedArticle.Type;

export interface IArticleExtractor {
  /**
   * Extracts the article from the parsed document. The content is already
   * sanitized (CM-ART-4) and a missing publish time is none. The adapter
   * decodes its own output into `ExtractedArticle`; that is its boundary
   * (CM-FETCH-3, CM-ART).
   */
  readonly extract: (
    document: Document
  ) => Effect.Effect<ExtractedArticle, ArticleExtractorError>;
}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('@reader/business/ArticleExtractor') {}
