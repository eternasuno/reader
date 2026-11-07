import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { SavedPageRepository } from '../../src/port/saved-page-repository';
import { unreadCounts } from '../../src/usecase/unread';
import { alice, feedId, otherFeedId, storedFeed } from '../support';

it.effect('combines saved and per-feed unread counts for the owner', () => {
  const requested: Array<ReadonlyArray<string>> = [];

  return unreadCounts(alice).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedRepository, {
          list: () =>
            Effect.succeed([storedFeed(feedId), storedFeed(otherFeedId)]),
        }),
        Layer.mock(FeedItemRepository, {
          unreadCounts: (feedIds) => {
            requested.push(feedIds);

            return Effect.succeed([
              { feedId, count: 3 },
              { feedId: otherFeedId, count: 4 },
            ]);
          },
        }),
        Layer.mock(SavedPageRepository, {
          unreadCount: () => Effect.succeed(2),
        })
      )
    ),
    Effect.tap((counts) =>
      Effect.sync(() => {
        expect(requested).toEqual([[feedId, otherFeedId]]);
        expect(counts).toEqual({
          saved: 2,
          feedsTotal: 7,
          feeds: [
            { id: feedId, count: 3 },
            { id: otherFeedId, count: 4 },
          ],
        });
      })
    )
  );
});

it.effect('reports zero counts for an owner without feeds', () =>
  unreadCounts(alice).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedRepository, { list: () => Effect.succeed([]) }),
        Layer.mock(FeedItemRepository, {
          unreadCounts: () => Effect.succeed([]),
        }),
        Layer.mock(SavedPageRepository, {
          unreadCount: () => Effect.succeed(0),
        })
      )
    ),
    Effect.tap((counts) =>
      Effect.sync(() =>
        expect(counts).toEqual({ saved: 0, feedsTotal: 0, feeds: [] })
      )
    )
  )
);
