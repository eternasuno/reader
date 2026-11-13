import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedId } from '../../entity/feed/feed';
import type { FolderId } from '../../entity/feed/folder';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../port/feed-repository';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../port/folder-repository';
import { FolderNotFound } from './errors';

export const moveFeed = (
  owner: OwnerId,
  feedId: FeedId,
  folderId: Option.Option<FolderId>
): Effect.Effect<
  void,
  FolderNotFound | FeedRepositoryError | FolderRepositoryError,
  FeedRepository | FolderRepository
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const moved = yield* feeds.moveToFolder(owner, feedId, folderId);

    if (moved) {
      return;
    }

    if (Option.isNone(folderId)) {
      return;
    }

    const folders = yield* FolderRepository;
    const target = folderId.value;
    const folder = yield* folders.find(owner, target);

    if (Option.isNone(folder)) {
      return yield* new FolderNotFound({ id: target });
    }
  });
