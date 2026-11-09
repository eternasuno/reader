import { Context, Data, type Effect, Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../entity/object-value/article';
import { OptionFromOptionalNonEmpty } from '../entity/object-value/option-from-optional-non-empty';

export class ArticleExtractorError extends Data.TaggedError(
  'ArticleExtractorError'
)<{
  readonly message: string;
}> {}

export const ExtractedArticle = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.DateTimeUtcFromDate,
});

export type ExtractedArticle = typeof ExtractedArticle.Type;

export interface IArticleExtractor {
  readonly extract: (
    document: Document
  ) => Effect.Effect<ExtractedArticle, ArticleExtractorError>;
}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('ArticleExtractor') {}
