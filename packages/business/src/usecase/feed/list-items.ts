import { Effect, Schema } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import { FeedId } from '../../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../entity/feed/feed-item';
import { FolderId } from '../../entity/feed/folder';
import {
  type FeedItemQuery,
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';

export const FeedItemScope = Schema.TaggedUnion({
  All: {},
  Feed: { feedId: FeedId },
  Folder: { folderId: FolderId },
});

export type FeedItemScope = typeof FeedItemScope.Type;

export type FeedItemListInput = {
  readonly scope: FeedItemScope;
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
    const query: FeedItemQuery = {
      unreadOnly: input.unreadOnly,
      limit: input.limit + 1,
      ...(input.cursor === undefined ? {} : { after: input.cursor }),
    };
    const rows = yield* FeedItemScope.match(input.scope, {
      All: () => repository.listAll(owner, query),
      Feed: ({ feedId }) => repository.listByFeed(owner, feedId, query),
      Folder: ({ folderId }) => repository.listByFolder(owner, folderId, query),
    });
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);

    return {
      items,
      cursor: rows.length > input.limit && last !== undefined ? last.id : null,
    };
  });
