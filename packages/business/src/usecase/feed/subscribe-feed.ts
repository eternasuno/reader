import { Effect, Option } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import { Feed, type FeedTitle } from '../../entity/feed/feed';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../port/feed-repository';
import { FeedAlreadyExists } from './errors';

export const subscribeFeed = (
  owner: OwnerId,
  url: NormalizedUrl,
  title: FeedTitle
): Effect.Effect<
  Feed,
  FeedAlreadyExists | FeedRepositoryError,
  FeedRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedRepository;
    const feed = yield* Feed.makeEffect({
      ownerId: owner,
      url,
      title,
      updatedAt: Option.none(),
    }).pipe(Effect.orDie);
    const created = yield* repository.create(owner, [feed]);

    if (created.length === 0) {
      return yield* new FeedAlreadyExists({ url });
    }

    return feed;
  });
