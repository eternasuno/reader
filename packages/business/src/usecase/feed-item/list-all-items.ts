import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed-item/feed-item';
import type { FeedItemRepositoryError } from '../../error/feed-item';
import { FeedItemRepository } from '../../port/feed-item-repository';
import { type PageInput, pageOf, pageQuery } from '../common/paging';

/**
 * One page of `全部订阅` (FD-LIST): the items of all the owner's feeds, newest
 * first (FD-LIST-4), narrowed by the unread filter (CM-PAGE-8) and paged by id
 * descending (CM-PAGE-1, CM-PAGE-4). One scope is one use case and one port
 * call, with no branching on a scope value (FD-LIST-1), and no feed is looked
 * up first.
 */
export const listAllFeedItems = Effect.fn('listAllFeedItems')(function* (
  owner: OwnerId,
  input: PageInput<FeedItemId>
) {
  const items = yield* FeedItemRepository;
  const rows = yield* items.listAll(owner, pageQuery(input));

  return pageOf<FeedItemId, FeedItem>(rows, input.limit);
});

/** The only failure of one page of all items (FD-LIST). */
export type ListAllFeedItemsError = FeedItemRepositoryError;

/** The ports one page of all items runs on (FD-LIST-1). */
export type ListAllFeedItemsPorts = FeedItemRepository;
