import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed-item/feed-item';
import type { FolderId } from '../../entity/folder/folder';
import type { FeedItemRepositoryError } from '../../error/feed-item';
import { FeedItemRepository } from '../../port/feed-item-repository';
import { type PageInput, pageOf, pageQuery } from '../common/paging';

/**
 * One page of a folder's items (FD-LIST): the items of the feeds that are in
 * the folder when the page is listed (FD-LIST-6), in the all-items order and
 * cursor shape (CM-PAGE-1, FD-LIST-4), through one port call (FD-LIST-1). A
 * folder that does not exist, is not the owner's, or is empty gives an empty
 * page and no error (FD-LIST-7, CM-OWN-3); nothing checks a cursor against the
 * scope (CM-PAGE-7).
 */
export const listFolderItems = Effect.fn('listFolderItems')(function* (
  owner: OwnerId,
  folderId: FolderId,
  input: PageInput<FeedItemId>
) {
  const items = yield* FeedItemRepository;
  const rows = yield* items.listByFolder(owner, folderId, pageQuery(input));

  return pageOf<FeedItemId, FeedItem>(rows, input.limit);
});

/** The only failure of one page of a folder's items (FD-LIST-7). */
export type ListFolderItemsError = FeedItemRepositoryError;

/** The ports one page of a folder's items runs on (FD-LIST-1). */
export type ListFolderItemsPorts = FeedItemRepository;
