import {
  Context,
  Data,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { FeedId } from '../entity/feed/feed';
import { FeedItem, type FeedItemId } from '../entity/feed/feed-item';

export class FeedItemRepositoryError extends Data.TaggedError(
  'FeedItemRepositoryError'
)<{ readonly message: string }> {}

export const FeedItemPatch = FeedItem.mapFields((fields) =>
  Struct.map(
    Struct.pick(fields, ['read', 'extractedContent']),
    Schema.optionalKey
  )
);

export type FeedItemPatch = typeof FeedItemPatch.Type;

export type FeedItemQuery = {
  readonly feedId?: FeedId;
  readonly unreadOnly: boolean;
  readonly after?: FeedItemId;
  readonly limit: number;
};

export type FeedItemKey = Pick<FeedItem, 'id' | 'url'>;

export type FeedUnreadCount = {
  readonly feedId: FeedId;
  readonly count: number;
};

export interface IFeedItemRepository {
  readonly find: (
    owner: OwnerId,
    id: FeedItemId
  ) => Effect.Effect<Option.Option<FeedItem>, FeedItemRepositoryError>;
  readonly list: (
    owner: OwnerId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  readonly create: (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly update: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    patch: FeedItemPatch
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly updateByFeeds: (
    owner: OwnerId,
    feedIds: ReadonlyArray<FeedId>,
    patch: FeedItemPatch
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly updateAll: (
    owner: OwnerId,
    patch: FeedItemPatch
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly unreadCounts: (
    owner: OwnerId
  ) => Effect.Effect<ReadonlyArray<FeedUnreadCount>, FeedItemRepositoryError>;
  readonly inventory: (
    owner: OwnerId,
    feedId: FeedId
  ) => Effect.Effect<ReadonlyArray<FeedItemKey>, FeedItemRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
}

export class FeedItemRepository extends Context.Service<
  FeedItemRepository,
  IFeedItemRepository
>()('@reader/business/FeedItemRepository') {}
