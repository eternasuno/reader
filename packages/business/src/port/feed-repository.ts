import { Context, Data, type DateTime, type Effect, type Option } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { Feed, FeedId, FeedTitle } from '../entity/feed/feed';
import type { FolderId } from '../entity/feed/folder';

export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}

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
  readonly moveToFolder: (
    owner: OwnerId,
    id: FeedId,
    folderId: Option.Option<FolderId>
  ) => Effect.Effect<boolean, FeedRepositoryError>;
  readonly recordSync: (
    owner: OwnerId,
    id: FeedId,
    title: FeedTitle,
    at: DateTime.Utc
  ) => Effect.Effect<void, FeedRepositoryError>;
  readonly remove: (
    owner: OwnerId,
    ids: ReadonlyArray<FeedId>
  ) => Effect.Effect<void, FeedRepositoryError>;
}

export class FeedRepository extends Context.Service<
  FeedRepository,
  IFeedRepository
>()('@reader/business/FeedRepository') {}
