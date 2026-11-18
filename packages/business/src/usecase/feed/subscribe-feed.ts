import { Effect, Option } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import { Feed, type FeedTitle } from '../../entity/feed/feed';
import type { FolderId } from '../../entity/folder/folder';
import { FeedAlreadyExists, type FeedRepositoryError } from '../../error/feed';
import { FolderNotFound, type FolderRepositoryError } from '../../error/folder';
import { FeedRepository } from '../../port/feed-repository';
import { FolderRepository } from '../../port/folder-repository';

/**
 * Subscribes the owner to a source: build the feed, create it and return it
 * (FD-SUB). Nothing is fetched and no clock is read; the HTTP layer enqueues
 * the new feed for refresh (FD-SCHED-7).
 *
 * A create that created nothing is either a taken URL (FD-SUB-1, FD-SUB-2) or a
 * folder that is not the owner's (FD-SUB-6); the folder is looked up only then,
 * to tell the two apart, and takes precedence (FD-SUB-7).
 */
export const subscribeFeed = Effect.fn('subscribeFeed')(function* (
  owner: OwnerId,
  url: NormalizedUrl,
  title: FeedTitle,
  folderId: Option.Option<FolderId>
): Effect.fn.Return<
  Feed,
  | FeedAlreadyExists
  | FolderNotFound
  | FeedRepositoryError
  | FolderRepositoryError,
  FeedRepository | FolderRepository
> {
  const feeds = yield* FeedRepository;
  const feed = yield* Feed.makeEffect({
    ownerId: owner,
    url,
    title,
    folderId,
    updatedAt: Option.none(),
  }).pipe(Effect.orDie);
  const created = yield* feeds.create(owner, [feed]);

  if (created.length > 0) {
    return feed;
  }

  if (Option.isSome(folderId)) {
    const folders = yield* FolderRepository;
    const folder = yield* folders.find(owner, folderId.value);

    if (Option.isNone(folder)) {
      return yield* new FolderNotFound({ id: folderId.value });
    }
  }

  return yield* new FeedAlreadyExists({ url });
});
