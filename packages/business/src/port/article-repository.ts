import { Context, Data, type Effect } from 'effect';
import type { ArticleContent, ArticleSource } from '../entity/article';

export class ArticleRepositoryError extends Data.TaggedError(
  'ArticleRepositoryError'
)<{
  readonly error: string;
}> {}

export class ArticleRepository extends Context.Service<
  ArticleRepository,
  {
    readonly metadata: (
      owner: string,
      kind: 'link' | 'feed',
      key: string
    ) => Effect.Effect<ArticleSource | undefined, ArticleRepositoryError>;
    readonly get: (
      owner: string,
      url: string
    ) => Effect.Effect<ArticleContent | undefined, ArticleRepositoryError>;
    readonly save: (
      owner: string,
      article: ArticleContent
    ) => Effect.Effect<void, ArticleRepositoryError>;
  }
>()('ArticleRepository') {}
