import { Effect } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedId } from '../../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../entity/feed/feed-item';
import {
  type FeedItemQuery,
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';

export type FeedItemListInput = {
  readonly feedId?: FeedId;
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly cursor?: FeedItemId;
};

export const listItems = (
  owner: OwnerId,
  input: FeedItemListInput
): Effect.Effect<
  {
    readonly items: ReadonlyArray<FeedItem>;
    readonly cursor: FeedItemId | null;
  },
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const repository = yield* FeedItemRepository;
    const rows = yield* repository.list(owner, {
      unreadOnly: input.unreadOnly,
      limit: input.limit + 1,
      ...(input.feedId === undefined ? {} : { feedId: input.feedId }),
      ...(input.cursor === undefined ? {} : { after: input.cursor }),
    } satisfies FeedItemQuery);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);

    return {
      items,
      cursor: rows.length > input.limit && last !== undefined ? last.id : null,
    };
  });
