import { Context, Data, type Effect } from 'effect';
import type { ReadingLink } from '../entity/reading-link';

export class LinkRepositoryError extends Data.TaggedError(
  'LinkRepositoryError'
)<{
  readonly cause: unknown;
}> {}

export class LinkRepository extends Context.Service<
  LinkRepository,
  {
    readonly list: (
      owner: string,
      read: boolean,
      offset: number,
      limit: number,
      all?: boolean,
      before?: string,
      beforeKey?: string
    ) => Effect.Effect<readonly ReadingLink[], LinkRepositoryError>;
    readonly unreadCount: (
      owner: string
    ) => Effect.Effect<number, LinkRepositoryError>;
    readonly insert: (
      owner: string,
      item: Omit<ReadingLink, 'key'>
    ) => Effect.Effect<ReadingLink | undefined, LinkRepositoryError>;
    readonly mark: (
      owner: string,
      key: string,
      read: boolean
    ) => Effect.Effect<boolean, LinkRepositoryError>;
    readonly markAll: (
      owner: string
    ) => Effect.Effect<void, LinkRepositoryError>;
    readonly markLoaded: (
      owner: string,
      keys: readonly string[]
    ) => Effect.Effect<void, LinkRepositoryError>;
    readonly remove: (
      owner: string,
      key: string
    ) => Effect.Effect<boolean, LinkRepositoryError>;
  }
>()('@reader/business/LinkRepository') {}
