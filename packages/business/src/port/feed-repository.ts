import {
  Context,
  Data,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import { Feed } from '../entity/feed';
import type { FeedId, OwnerId } from '../entity/object-value';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}

export const FeedPatch = Feed.mapFields((fields) =>
  Struct.map(
    Struct.pick(fields, ['url', 'title', 'updatedAt']),
    Schema.optionalKey
  )
);

export type FeedPatch = typeof FeedPatch.Type;

export type FeedUpdate = {
  readonly id: FeedId;
  readonly feedPatch: FeedPatch;
};

export type IFeedRepository = {
  readonly find: (
    ownerId: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, FeedRepositoryError>;
  readonly list: (
    ownerId: OwnerId
  ) => Effect.Effect<readonly Feed[], FeedRepositoryError>;
  readonly create: (
    ownerId: OwnerId,
    feeds: readonly Feed[]
  ) => Effect.Effect<readonly FeedId[], FeedRepositoryError>;
  readonly remove: (
    ownerId: OwnerId,
    ids: readonly FeedId[]
  ) => Effect.Effect<void, FeedRepositoryError>;
  readonly update: (
    ownerId: OwnerId,
    updates: readonly FeedUpdate[]
  ) => Effect.Effect<void, FeedRepositoryError>;
};

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('reader/FeedRepository') {}
