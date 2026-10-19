import { Context, type Effect, Schema } from 'effect';
import type { ReadingLink } from '../entity/reading-link';

export class LinkRepositoryError extends Schema.TaggedError<LinkRepositoryError>()(
  'LinkRepositoryError',
  { cause: Schema.Unknown }
) {}

export class LinkRepository extends Context.Service<
  LinkRepository,
  {
    readonly list: (
      owner: string,
      read: boolean,
      offset: number,
      limit: number
    ) => Effect.Effect<readonly ReadingLink[], LinkRepositoryError>;
    readonly insert: (
      owner: string,
      item: Omit<ReadingLink, 'key'>
    ) => Effect.Effect<ReadingLink | undefined, LinkRepositoryError>;
    readonly mark: (
      owner: string,
      key: string,
      read: boolean
    ) => Effect.Effect<boolean, LinkRepositoryError>;
    readonly remove: (
      owner: string,
      key: string
    ) => Effect.Effect<boolean, LinkRepositoryError>;
  }
>()('@reader/business/LinkRepository') {}
