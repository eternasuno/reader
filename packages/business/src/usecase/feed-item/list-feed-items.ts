import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedId, FeedOrder } from '../../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../entity/feed-item/feed-item';
import type { FeedItemRepositoryError } from '../../error/feed-item';
import { FeedItemRepository } from '../../port/feed-item-repository';
import { type PageInput, pageOf, pageQuery } from '../common/paging';

/**
 * One page of one feed's items (FD-LIST): the all-items list restricted to
 * that feed, in arrival order or, under `oldest`, its reverse (CM-PAGE-1,
 * FD-LIST-4, FD-PREF-3), through one port call (FD-LIST-1). A feed that does not exist, or is not the
 * owner's, gives an empty page and no error (FD-LIST-2, CM-OWN-3); the feed is
 * not looked up first.
 */
export const listFeedItems = Effect.fn('listFeedItems')(function* (
  owner: OwnerId,
  feedId: FeedId,
  input: PageInput<FeedItemId>,
  order: FeedOrder
) {
  const items = yield* FeedItemRepository;
  const rows = yield* items.listByFeed(owner, feedId, pageQuery(input), order);

  return pageOf<FeedItemId, FeedItem>(rows, input.limit);
});

/** The only failure of one page of a feed's items (FD-LIST-2). */
export type ListFeedItemsError = FeedItemRepositoryError;

/** The ports one page of a feed's items runs on (FD-LIST-1). */
export type ListFeedItemsPorts = FeedItemRepository;
