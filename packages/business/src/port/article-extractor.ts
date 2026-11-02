import { Context, Data, type Effect } from 'effect';
import type { Article } from '../entity/article';

export class ArticleExtractError extends Data.TaggedError(
  'ArticleExtractError'
)<{
  readonly error: string;
}> {}

export type ExtractedArticle = Pick<Article, 'title'> &
  Partial<Pick<Article, 'description' | 'publishedAt'>> & {
    readonly content: NonNullable<Article['content']>;
  };

export interface IArticleExtractor {
  readonly extract: (
    document: Document
  ) => Effect.Effect<ExtractedArticle, ArticleExtractError>;
}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('ArticleExtractor') {}
