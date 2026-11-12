import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  fetchFeedItem,
  fetchFeedItems,
  fetchUnreadFeeds,
  markFeedItem,
  markFeedItemsRead,
  readItem,
  readItemPage,
  readUnreadFeeds,
  seedFeed,
  seedItem,
  sessionFor,
} from './library-feeds-support';
import { type Harness, makeHarness, type TestSession } from './library-support';

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const markBatchAndRead = async (
  harness: Harness,
  session: TestSession,
  ids: ReadonlyArray<string>
) => {
  const response = await markFeedItemsRead(harness, session, ids);
  const page = await readItemPage(
    await fetchFeedItems(harness, session, { limit: 30 })
  );
  const unread = await readUnreadFeeds(
    await fetchUnreadFeeds(harness, session)
  );

  return {
    response,
    states: page.page.items.map((item) => [item.id, item.read]),
    unread,
  };
};

it.effect('marks one item read and unread again', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);

      const read = yield* Effect.promise(() =>
        markFeedItem(harness, alice, { id: item.id, read: true })
      );
      const afterRead = yield* Effect.promise(async () =>
        readItem(await fetchFeedItem(harness, alice, item.id))
      );
      const unreadFeeds = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, alice)
      );
      const unread = yield* Effect.promise(() =>
        markFeedItem(harness, alice, { id: item.id, read: false })
      );
      const afterUnread = yield* Effect.promise(async () =>
        readItem(await fetchFeedItem(harness, alice, item.id))
      );
      const unreadAgain = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, alice)
      );

      expect(read.status).toBe(200);
      expect(afterRead.item?.read).toBe(true);
      expect(yield* Effect.promise(() => readUnreadFeeds(unreadFeeds))).toEqual(
        { feeds: [] }
      );
      expect(unread.status).toBe(200);
      expect(afterUnread.item?.read).toBe(false);
      expect(yield* Effect.promise(() => readUnreadFeeds(unreadAgain))).toEqual(
        { feeds: [{ feedId: feed.id, count: 1 }] }
      );
    })
  )
);

it.effect('marking unknown or foreign ids succeeds and changes nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const theirItem = yield* seedItem(harness, bob.owner, theirs.id);

      const unknown = yield* Effect.promise(() =>
        markFeedItem(harness, alice, { id: unknownId, read: true })
      );
      const foreign = yield* Effect.promise(() =>
        markFeedItem(harness, alice, { id: theirItem.id, read: true })
      );
      const mine = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, item.id)
      );
      const theirStored = yield* Effect.promise(() =>
        fetchFeedItem(harness, bob, theirItem.id)
      );

      expect(unknown.status).toBe(200);
      expect(foreign.status).toBe(200);
      expect(
        yield* Effect.promise(() => harness.json<object>(foreign))
      ).toEqual({ ok: true });
      expect((yield* Effect.promise(() => readItem(mine))).item?.read).toBe(
        false
      );
      expect(
        (yield* Effect.promise(() => readItem(theirStored))).item?.read
      ).toBe(false);
    })
  )
);

it.effect('marks a batch of items read and ignores unknown ids', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const first = yield* seedItem(harness, alice.owner, feed.id);
      const second = yield* seedItem(harness, alice.owner, feed.id);
      const third = yield* seedItem(harness, alice.owner, feed.id);
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const theirItem = yield* seedItem(harness, bob.owner, theirs.id);

      const outcome = yield* Effect.promise(() =>
        markBatchAndRead(harness, alice, [
          first.id,
          second.id,
          theirItem.id,
          unknownId,
        ])
      );
      const theirStored = yield* Effect.promise(() =>
        fetchFeedItem(harness, bob, theirItem.id)
      );

      expect(outcome.response.status).toBe(200);
      expect(
        yield* Effect.promise(() => harness.json<object>(outcome.response))
      ).toEqual({ ok: true });
      expect(outcome.states).toEqual([
        [third.id, false],
        [second.id, true],
        [first.id, true],
      ]);
      expect(outcome.unread).toEqual({
        feeds: [{ feedId: feed.id, count: 1 }],
      });
      expect(
        (yield* Effect.promise(() => readItem(theirStored))).item?.read
      ).toBe(false);
    })
  )
);

it.effect('rejects a batch larger than the id limit', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const item = yield* seedItem(harness, alice.owner, feed.id);
      const ids = Array.from(
        { length: 5000 },
        (_, index) => `01234567-89ab-7cde-${String(index).padStart(12, '0')}`
      );

      const response = yield* Effect.promise(() =>
        markFeedItemsRead(harness, alice, [...ids, item.id])
      );
      const stored = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, item.id)
      );

      expect(response.status).toBe(400);
      expect((yield* Effect.promise(() => readItem(stored))).item?.read).toBe(
        false
      );
    })
  )
);
