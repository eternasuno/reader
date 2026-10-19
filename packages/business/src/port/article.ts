import { Context, type Effect, type Redacted, Schema } from 'effect';
import type { ArticleContent, ArticleSource } from '../entity/article';

export class ArticleFailure extends Schema.TaggedError<ArticleFailure>()(
  'ArticleFailure',
  { error: Schema.String }
) {}

export class ReaderCredentials extends Context.Service<
  ReaderCredentials,
  {
    readonly get: (
      owner: string
    ) => Effect.Effect<Redacted.Redacted<string> | undefined, ArticleFailure>;
    readonly set: (
      owner: string,
      key: Redacted.Redacted<string>
    ) => Effect.Effect<void, ArticleFailure>;
    readonly remove: (owner: string) => Effect.Effect<void, ArticleFailure>;
    readonly configured: (
      owner: string
    ) => Effect.Effect<boolean, ArticleFailure>;
  }
>()('ReaderCredentials') {}

export class ArticleRepository extends Context.Service<
  ArticleRepository,
  {
    readonly metadata: (
      owner: string,
      kind: 'link' | 'feed',
      key: string
    ) => Effect.Effect<ArticleSource | undefined, ArticleFailure>;
    readonly source: (
      owner: string,
      kind: 'link' | 'feed',
      key: string
    ) => Effect.Effect<string | undefined, ArticleFailure>;
    readonly get: (
      owner: string,
      url: string
    ) => Effect.Effect<ArticleContent | undefined, ArticleFailure>;
    readonly save: (
      owner: string,
      article: ArticleContent
    ) => Effect.Effect<void, ArticleFailure>;
  }
>()('ArticleRepository') {}

export class WebpageFetcher extends Context.Service<
  WebpageFetcher,
  {
    readonly fetch: (
      url: string,
      key: Redacted.Redacted<string>
    ) => Effect.Effect<string, ArticleFailure>;
  }
>()('WebpageFetcher') {}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  {
    readonly extract: (
      html: string,
      url: string
    ) => Effect.Effect<{ title: string; html: string }, ArticleFailure>;
  }
>()('ArticleExtractor') {}
