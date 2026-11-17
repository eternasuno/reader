import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedId } from '../../entity/feed/feed';
import type { FolderId } from '../../entity/folder/folder';
import type { FeedRepositoryError } from '../../error/feed';
import { FolderNotFound, type FolderRepositoryError } from '../../error/folder';
import { FeedRepository } from '../../port/feed-repository';
import { FolderRepository } from '../../port/folder-repository';

/**
 * Moves a feed into a folder, or to the top level when `folderId` is none
 * (FD-MOVE). A move that wrote nothing is either a folder that is not the
 * owner's (FD-MOVE-3) or a feed that does not exist for the owner, which simply
 * succeeds (FD-OWN-2). The feed's items, read state, title and `updatedAt` are
 * untouched (FD-MOVE-2).
 */
export const moveFeed = Effect.fn('moveFeed')(function* (
  owner: OwnerId,
  feedId: FeedId,
  folderId: Option.Option<FolderId>
): Effect.fn.Return<
  void,
  FolderNotFound | FeedRepositoryError | FolderRepositoryError,
  FeedRepository | FolderRepository
> {
  const feeds = yield* FeedRepository;
  const moved = yield* feeds.moveToFolder(owner, feedId, folderId);

  if (moved || Option.isNone(folderId)) {
    return;
  }

  const folders = yield* FolderRepository;
  const folder = yield* folders.find(owner, folderId.value);

  if (Option.isNone(folder)) {
    return yield* new FolderNotFound({ id: folderId.value });
  }
});
