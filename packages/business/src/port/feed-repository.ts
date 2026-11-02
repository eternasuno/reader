import { Context, Data, type Effect, type Option } from 'effect';
import type { Feed } from '../entity/feed';
import type { FeedId, OwnerId } from '../entity/object-value';

export class SubscriptionReadError extends Data.TaggedError(
  'SubscriptionReadError'
)<{ readonly message: string }> {}

export class SubscriptionWriteError extends Data.TaggedError(
  'SubscriptionWriteError'
)<{ readonly message: string }> {}

export interface IFeedRepository {
  readonly find: (
    ownerId: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, SubscriptionReadError>;
  readonly list: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly Feed[], SubscriptionReadError>;
  readonly create: (
    feed: Feed
  ) => Effect.Effect<boolean, SubscriptionWriteError>;
  readonly remove: (
    ownerId: OwnerId,
    id: FeedId
  ) => Effect.Effect<void, SubscriptionWriteError>;
  readonly update: (feed: Feed) => Effect.Effect<void, SubscriptionWriteError>;
  readonly all: Effect.Effect<readonly Feed[], SubscriptionReadError>;
}

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('reader/FeedRepository') {}
