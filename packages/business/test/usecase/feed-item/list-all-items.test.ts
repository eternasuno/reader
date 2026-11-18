import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { listAllFeedItems } from '../../../src/usecase/feed-item/list-all-items';
import { alice, bob, idsOf, rowAt } from '../../support/fixtures';
import { runItems, storeFeedWithItems } from './harness';

describe('listAllFeedItems', () => {
  it.effect('FD-LIST-4 lists every feed’s items newest first', () =>
    runItems(
      Effect.gen(function* () {
        const older = yield* storeFeedWithItems(2);
        const newer = yield* storeFeedWithItems(1);

        const page = yield* listAllFeedItems(alice, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([
          rowAt(newer.items, 0).id,
          rowAt(older.items, 1).id,
          rowAt(older.items, 0).id,
        ]);
        expect(page.cursor).toBeNull();
      })
    )
  );

  it.effect('FD-LIST-1 lists the items of the owner’s feeds only', () =>
    runItems(
      Effect.gen(function* () {
        const mine = yield* storeFeedWithItems(1);
        const theirs = yield* storeFeedWithItems(1, {}, bob);

        const page = yield* listAllFeedItems(alice, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([rowAt(mine.items, 0).id]);
        expect(idsOf(page.items)).not.toContain(rowAt(theirs.items, 0).id);
      })
    )
  );
});

describe('listAllFeedItems paging', () => {
  it.effect(
    'CM-PAGE-4 pages after the cursor and ends with a null cursor',
    () =>
      runItems(
        Effect.gen(function* () {
          const { items } = yield* storeFeedWithItems(3);

          const first = yield* listAllFeedItems(alice, {
            limit: 2,
            unread: false,
            cursor: Option.none(),
          });
          const second = yield* listAllFeedItems(alice, {
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

  it.effect('CM-PAGE-8 narrows the list to unread items', () =>
    runItems(
      Effect.gen(function* () {
        const first = yield* storeFeedWithItems(1);
        const second = yield* storeFeedWithItems(1);
        const items = yield* FeedItemRepository;

        yield* items.markRead(alice, [rowAt(first.items, 0).id], true);

        const page = yield* listAllFeedItems(alice, {
          limit: 10,
          unread: true,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([rowAt(second.items, 0).id]);
      })
    )
  );
});
