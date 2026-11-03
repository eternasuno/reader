import { Context, Data, type Effect, type Option } from 'effect';
import type { Feed } from '../entity/feed';
import type { FeedId, OwnerId } from '../entity/object-value';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}

export type IFeedRepository = {
  readonly find: (
    ownerId: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, FeedRepositoryError>;
  readonly list: (
    ownerId?: OwnerId
  ) => Effect.Effect<readonly Feed[], FeedRepositoryError>;
  readonly create: (
    feeds: readonly Feed[]
  ) => Effect.Effect<readonly FeedId[], FeedRepositoryError>;
  readonly remove: (
    ownerId: OwnerId,
    ids: readonly FeedId[]
  ) => Effect.Effect<void, FeedRepositoryError>;
  readonly update: (
    feeds: readonly Feed[]
  ) => Effect.Effect<void, FeedRepositoryError>;
};

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('reader/FeedRepository') {}
