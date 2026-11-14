import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedId } from '../../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../entity/feed/feed-item';
import type { FolderId } from '../../entity/feed/folder';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';
import { type Page, type PageInput, pageOf, pageQuery } from '../common/paging';

export const listAllItems = (
  owner: OwnerId,
  page: PageInput<FeedItemId>
): Effect.Effect<
  Page<FeedItem, FeedItemId>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedItemRepository;
    const rows = yield* repository.listAll(owner, pageQuery(page));

    return pageOf<FeedItemId, FeedItem>(rows, page.limit);
  });

export const listFeedItems = (
  owner: OwnerId,
  feedId: FeedId,
  page: PageInput<FeedItemId>
): Effect.Effect<
  Page<FeedItem, FeedItemId>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedItemRepository;
    const rows = yield* repository.listByFeed(owner, feedId, pageQuery(page));

    return pageOf<FeedItemId, FeedItem>(rows, page.limit);
  });

export const listFolderItems = (
  owner: OwnerId,
  folderId: FolderId,
  page: PageInput<FeedItemId>
): Effect.Effect<
  Page<FeedItem, FeedItemId>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedItemRepository;
    const rows = yield* repository.listByFolder(
      owner,
      folderId,
      pageQuery(page)
    );

    return pageOf<FeedItemId, FeedItem>(rows, page.limit);
  });
