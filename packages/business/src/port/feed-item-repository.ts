import {
  Context,
  Data,
  type DateTime,
  type Effect,
  type Option,
  Schema,
  Struct,
} from 'effect';
import type { FeedId } from '../entity/feed/feed';
import { FeedItem, type FeedItemId } from '../entity/feed/feed-item';
import type { ReadFilter } from './read-filter';

export class FeedItemRepositoryError extends Data.TaggedError(
  'FeedItemRepositoryError'
)<{ readonly message: string }> {}

export type FeedItemBoundary = {
  readonly publishedAt: DateTime.Utc;
  readonly id: FeedItemId;
};

export type FeedItemQuery = {
  readonly filter: ReadFilter;
  readonly after?: FeedItemBoundary;
  readonly through?: FeedItemBoundary;
  readonly limit: number;
};

export const FeedItemPatch = FeedItem.mapFields((fields) =>
  Struct.map(
    Struct.pick(fields, ['read', 'extractedContent']),
    Schema.optionalKey
  )
);

export type FeedItemPatch = typeof FeedItemPatch.Type;

export type FeedItemUnreadCount = {
  readonly feedId: FeedId;
  readonly count: number;
};

/**
 * Items are owned through their feed: callers must first resolve the feeds
 * through `FeedRepository` for the current owner, then pass the feed ids here.
 */
export type IFeedItemRepository = {
  readonly find: (
    feedId: FeedId,
    id: FeedItemId
  ) => Effect.Effect<Option.Option<FeedItem>, FeedItemRepositoryError>;
  readonly list: (
    feedIds: ReadonlyArray<FeedId>,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  readonly create: (
    items: ReadonlyArray<FeedItem>
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly update: (
    feedId: FeedId,
    ids: ReadonlyArray<FeedItemId>,
    patch: FeedItemPatch
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly updateByFeeds: (
    feedIds: ReadonlyArray<FeedId>,
    patch: FeedItemPatch
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly unreadCounts: (
    feedIds: ReadonlyArray<FeedId>
  ) => Effect.Effect<
    ReadonlyArray<FeedItemUnreadCount>,
    FeedItemRepositoryError
  >;
  readonly inventory: (
    feedId: FeedId
  ) => Effect.Effect<ReadonlyArray<FeedItemBoundary>, FeedItemRepositoryError>;
  readonly retain: (
    feedId: FeedId,
    ids: ReadonlyArray<FeedItemId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
};

export class FeedItemRepository extends Context.Service<
  FeedItemRepository,
  IFeedItemRepository
>()('@reader/business/FeedItemRepository') {}
