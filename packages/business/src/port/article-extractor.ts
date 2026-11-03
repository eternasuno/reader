import { Context, Data, type Effect, Struct } from 'effect';
import { Article } from '../entity/article';

export class ArticleExtractError extends Data.TaggedError(
  'ArticleExtractError'
)<{
  readonly error: string;
}> {}

export const ExtractedArticle = Article.mapFields(
  Struct.pick(['title', 'description', 'content', 'publishedAt'])
);

export type ExtractedArticle = typeof ExtractedArticle.Type;

export type IArticleExtractor = {
  readonly extract: (
    document: Document
  ) => Effect.Effect<ExtractedArticle, ArticleExtractError>;
};

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('ArticleExtractor') {}
