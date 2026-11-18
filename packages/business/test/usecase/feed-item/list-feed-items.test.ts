import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { FeedId } from '../../../src/entity/feed/feed';
import type { FeedItemId } from '../../../src/entity/feed-item/feed-item';
import { listFeedItems } from '../../../src/usecase/feed-item/list-feed-items';
import {
  alice,
  bob,
  idsOf,
  makeUniqueFeed,
  rowAt,
} from '../../support/fixtures';
import { runItems, storeFeedWithItems } from './harness';

const input = (
  limit = 10,
  cursor: Option.Option<FeedItemId> = Option.none()
) => ({ limit, unread: false, cursor });

const newest = (feedId: FeedId, page = input()) =>
  listFeedItems(alice, feedId, page, 'newest');

const oldest = (feedId: FeedId, page = input()) =>
  listFeedItems(alice, feedId, page, 'oldest');

describe('listFeedItems', () => {
  it.effect('FD-LIST-4 lists only the items of that feed, newest first', () =>
    runItems(
      Effect.gen(function* () {
        const scope = yield* storeFeedWithItems(2);
        const other = yield* storeFeedWithItems(1);

        const page = yield* newest(scope.feed.id, input());

        expect(idsOf(page.items)).toStrictEqual([
          rowAt(scope.items, 1).id,
          rowAt(scope.items, 0).id,
        ]);
        expect(idsOf(page.items)).not.toContain(rowAt(other.items, 0).id);
      })
    )
  );

  it.effect('FD-LIST-2 answers an empty page for an unknown feed', () =>
    runItems(
      Effect.gen(function* () {
        const page = yield* newest(makeUniqueFeed().id, input());

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );

  it.effect('FD-LIST-2 answers an empty page for another owner’s feed', () =>
    runItems(
      Effect.gen(function* () {
        const theirs = yield* storeFeedWithItems(1, {}, bob);

        const page = yield* newest(theirs.feed.id, input());

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );
});

describe('listFeedItems paging', () => {
  it.effect(
    'CM-PAGE-1 CM-PAGE-4 carries the same cursor shape as all items',
    () =>
      runItems(
        Effect.gen(function* () {
          const { feed, items } = yield* storeFeedWithItems(3);

          const first = yield* newest(feed.id, input(2));
          const second = yield* newest(
            feed.id,
            input(2, Option.some(first.cursor ?? rowAt(items, 0).id))
          );

          expect(idsOf(first.items)).toStrictEqual([
            rowAt(items, 2).id,
            rowAt(items, 1).id,
          ]);
          expect(first.cursor).toBe(rowAt(items, 1).id);
          expect(idsOf(second.items)).toStrictEqual([rowAt(items, 0).id]);
          expect(second.cursor).toBeNull();
        })
      )
  );

  it.effect('FD-PREF-3 pages a feed oldest first when asked', () =>
    runItems(
      Effect.gen(function* () {
        const { feed, items } = yield* storeFeedWithItems(3);

        const first = yield* oldest(feed.id, input(2));
        const second = yield* oldest(
          feed.id,
          input(2, Option.some(first.cursor ?? rowAt(items, 0).id))
        );

        expect(idsOf(first.items)).toStrictEqual([
          rowAt(items, 0).id,
          rowAt(items, 1).id,
        ]);
        expect(idsOf(second.items)).toStrictEqual([rowAt(items, 2).id]);
        expect(second.cursor).toBeNull();
      })
    )
  );
});
