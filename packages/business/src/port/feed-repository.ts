import { Context, Data, type Effect } from 'effect';
import type { Feed, FeedArticle } from '../entity/feed';
import type { FeedImport } from '../entity/feed-import';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{
  readonly cause: unknown;
}> {}

export class FeedRepository extends Context.Service<
  FeedRepository,
  {
    readonly list: (
      owner: string
    ) => Effect.Effect<readonly Feed[], FeedRepositoryError>;
    readonly find: (
      owner: string,
      key: string
    ) => Effect.Effect<Feed | undefined, FeedRepositoryError>;
    readonly createSubscribed: (
      owner: string,
      url: string,
      imported: FeedImport,
      now: string
    ) => Effect.Effect<Feed, FeedRepositoryError>;
    readonly remove: (
      owner: string,
      key: string
    ) => Effect.Effect<boolean, FeedRepositoryError>;
    readonly sync: (
      owner: string,
      key: string,
      imported: FeedImport,
      now: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly failure: (
      owner: string,
      key: string,
      message: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly articles: (
      owner: string,
      feedKey: string,
      read: boolean,
      offset: number,
      limit: number,
      all?: boolean,
      before?: string,
      beforeKey?: string
    ) => Effect.Effect<readonly FeedArticle[], FeedRepositoryError>;
    readonly mark: (
      owner: string,
      key: string,
      read: boolean
    ) => Effect.Effect<boolean, FeedRepositoryError>;
    readonly markAll: (
      owner: string,
      feedKey: string
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly markLoaded: (
      owner: string,
      keys: readonly string[]
    ) => Effect.Effect<void, FeedRepositoryError>;
    readonly article: (
      owner: string,
      key: string
    ) => Effect.Effect<FeedArticle | undefined, FeedRepositoryError>;
    readonly subscriptions: Effect.Effect<
      readonly { owner: string; key: string }[],
      FeedRepositoryError
    >;
  }
>()('@reader/business/FeedRepository') {}
