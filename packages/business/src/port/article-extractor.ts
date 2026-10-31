import { Context, Data, type Effect } from 'effect';

export class ArticleExtractError extends Data.TaggedError(
  'ArticleExtractError'
)<{
  readonly error: string;
}> {}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  {
    readonly extract: (
      html: string,
      url: string
    ) => Effect.Effect<{ title: string; html: string }, ArticleExtractError>;
  }
>()('ArticleExtractor') {}
