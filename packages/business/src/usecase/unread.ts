import { Effect, Schema } from 'effect';
import { FeedId } from '../entity/feed/feed';
import type { OwnerId } from '../entity/object-value/owner-id';
import { FeedItemRepository } from '../port/feed-item-repository';
import { FeedRepository } from '../port/feed-repository';
import { SavedPageRepository } from '../port/saved-page-repository';

export const UnreadCounts = Schema.Struct({
  saved: Schema.Int,
  feedsTotal: Schema.Int,
  feeds: Schema.Array(Schema.Struct({ id: FeedId, count: Schema.Int })),
});

export type UnreadCounts = typeof UnreadCounts.Type;

export const unreadCounts = (owner: OwnerId) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feedItems = yield* FeedItemRepository;
    const pages = yield* SavedPageRepository;
    const feedIds = (yield* feeds.list(owner)).map((feed) => feed.id);
    const rows = yield* feedItems.unreadCounts(feedIds);
    const saved = yield* pages.unreadCount(owner);

    return {
      saved,
      feedsTotal: rows.reduce((sum, row) => sum + row.count, 0),
      feeds: rows.map((row) => ({ id: row.feedId, count: row.count })),
    } satisfies UnreadCounts;
  });
