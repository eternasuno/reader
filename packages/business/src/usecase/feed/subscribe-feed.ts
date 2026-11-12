import { Effect, Option } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import { Feed, type FeedTitle } from '../../entity/feed/feed';
import type { FolderId } from '../../entity/feed/folder';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../port/feed-repository';
import {
  FolderRepository,
  type FolderRepositoryError,
} from '../../port/folder-repository';
import { FeedAlreadyExists, FolderNotFound } from './errors';

export const subscribeFeed = (
  owner: OwnerId,
  url: NormalizedUrl,
  title: FeedTitle,
  folderId: Option.Option<FolderId>
): Effect.Effect<
  Feed,
  | FeedAlreadyExists
  | FolderNotFound
  | FeedRepositoryError
  | FolderRepositoryError,
  FeedRepository | FolderRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedRepository;
    const feed = yield* Feed.makeEffect({
      ownerId: owner,
      url,
      title,
      folderId,
      updatedAt: Option.none(),
    }).pipe(Effect.orDie);
    const created = yield* repository.create(owner, [feed]);

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
