import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { listFeedItems } from '../../../src/usecase/feed-item/list-feed-items';
import {
  alice,
  bob,
  idsOf,
  makeUniqueFeed,
  rowAt,
} from '../../support/fixtures';
import { runItems, storeFeedWithItems } from './harness';

describe('listFeedItems', () => {
  it.effect('FD-LIST-4 lists only the items of that feed, newest first', () =>
    runItems(
      Effect.gen(function* () {
        const scope = yield* storeFeedWithItems(2);
        const other = yield* storeFeedWithItems(1);

        const page = yield* listFeedItems(alice, scope.feed.id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

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
        const page = yield* listFeedItems(alice, makeUniqueFeed().id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );

  it.effect('FD-LIST-2 answers an empty page for another owner’s feed', () =>
    runItems(
      Effect.gen(function* () {
        const theirs = yield* storeFeedWithItems(1, {}, bob);

        const page = yield* listFeedItems(alice, theirs.feed.id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

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

          const first = yield* listFeedItems(alice, feed.id, {
            limit: 2,
            unread: false,
            cursor: Option.none(),
          });
          const second = yield* listFeedItems(alice, feed.id, {
            limit: 2,
            unread: false,
            cursor: Option.some(first.cursor ?? rowAt(items, 0).id),
          });

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
});
