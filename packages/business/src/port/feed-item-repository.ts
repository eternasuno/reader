import { Context, Data, type Effect, type Option } from 'effect';
import type { ArticleContent } from '../entity/common/article';
import type { OwnerId } from '../entity/common/owner-id';
import type { FeedId } from '../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../entity/feed/feed-item';
import type { FolderId } from '../entity/feed/folder';

export class FeedItemRepositoryError extends Data.TaggedError(
  'FeedItemRepositoryError'
)<{ readonly message: string }> {}

export type FeedItemQuery = {
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
  readonly listAll: (
    owner: OwnerId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  readonly listByFeed: (
    owner: OwnerId,
    feedId: FeedId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  readonly listByFolder: (
    owner: OwnerId,
    folderId: FolderId,
    query: FeedItemQuery
  ) => Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError>;
  readonly create: (
    owner: OwnerId,
    items: ReadonlyArray<FeedItem>
  ) => Effect.Effect<ReadonlyArray<FeedItemId>, FeedItemRepositoryError>;
  readonly markRead: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedItemId>,
    read: boolean
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly markReadByFeeds: (
    owner: OwnerId,
    feedIds: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly markReadByFolders: (
    owner: OwnerId,
    folderIds: ReadonlyArray<FolderId>
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly markAllRead: (
    owner: OwnerId
  ) => Effect.Effect<void, FeedItemRepositoryError>;
  readonly setExtractedContent: (
    owner: OwnerId,
    id: FeedItemId,
    content: ArticleContent
  ) => Effect.Effect<boolean, FeedItemRepositoryError>;
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
