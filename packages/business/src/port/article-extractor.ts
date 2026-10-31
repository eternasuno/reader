import { Context, Data, type DateTime, type Effect } from 'effect';

export class ArticleExtractError extends Data.TaggedError(
  'ArticleExtractError'
)<{
  readonly error: string;
}> {}

export type ExtractedArticle = {
  readonly title: string;
  readonly html: string;
  readonly description?: string;
  readonly publishedAt?: DateTime.Utc;
};

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  {
    readonly extract: (
      html: string,
      url: string
    ) => Effect.Effect<ExtractedArticle, ArticleExtractError>;
  }
>()('ArticleExtractor') {}
