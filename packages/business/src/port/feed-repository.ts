import {
  Context,
  Data,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import { Feed, type FeedId } from '../entity/feed/feed';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}

export const FeedPatch = Feed.mapFields((fields) =>
  Struct.map(Struct.pick(fields, ['title', 'updatedAt']), Schema.optionalKey)
);

export type FeedPatch = typeof FeedPatch.Type;

export interface IFeedRepository {
  readonly find: (
    owner: OwnerId,
    id: FeedId
  ) => Effect.Effect<Option.Option<Feed>, FeedRepositoryError>;
  readonly list: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<Feed>, FeedRepositoryError>;
  readonly create: (
    owner: OwnerId,
    feeds: ReadonlyArray<Feed>
  ) => Effect.Effect<ReadonlyArray<FeedId>, FeedRepositoryError>;
  readonly update: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedId>,
    patch: FeedPatch
  ) => Effect.Effect<ReadonlyArray<FeedId>, FeedRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedRepositoryError>;
}

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('@reader/business/FeedRepository') {}
