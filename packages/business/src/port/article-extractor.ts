import { Context, Data, type Effect, Struct } from 'effect';
import { Article } from '../entity/article';

export class ArticleExtractorError extends Data.TaggedError(
  'ArticleExtractorError'
)<{
  readonly message: string;
}> {}

export const ExtractedArticle = Article.mapFields(
  Struct.pick(['title', 'description', 'content', 'publishedAt'])
);

export type ExtractedArticle = typeof ExtractedArticle.Type;

export type IArticleExtractor = {
  readonly extract: (
    document: Document
  ) => Effect.Effect<ExtractedArticle, ArticleExtractorError>;
};

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('ArticleExtractor') {}
