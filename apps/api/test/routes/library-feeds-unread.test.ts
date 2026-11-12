import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  fetchFeedItems,
  fetchUnreadFeeds,
  markAllFeedItemsRead,
  markFeedsRead,
  readItemPage,
  readUnreadFeeds,
  seedFeed,
  seedFeedItems,
  seedItem,
  seedSavedPageFromItem,
  sessionFor,
} from './library-feeds-support';
import { type Harness, makeHarness, type TestSession } from './library-support';

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const markAllAndRead = async (harness: Harness, session: TestSession) => {
  const response = await markAllFeedItemsRead(harness, session);
  const unread = await readUnreadFeeds(
    await fetchUnreadFeeds(harness, session)
  );
  const items = await readItemPage(
    await fetchFeedItems(harness, session, { unreadOnly: true, limit: 30 })
  );
  const savedUnread = await harness.json<{ count: number }>(
    await harness.call({
      path: '/api/library/saved-pages/unread',
      cookie: session.cookie,
    })
  );
  const saved = await harness.json<{
    items: ReadonlyArray<{ id: string; read: boolean }>;
  }>(
    await harness.call({
      path: '/api/library/saved-pages',
      query: { limit: 10 },
      cookie: session.cookie,
    })
  );

  return {
    response,
    unread,
    itemIds: items.page.items.map((item) => item.id),
    savedUnread,
    saved: saved.items.map((page) => [page.id, page.read]),
  };
};

it.effect('counts unread items per feed for the caller only', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const first = yield* seedFeed(harness, alice.owner, { title: 'First' });
      const second = yield* seedFeed(harness, alice.owner, { title: 'Second' });
      const empty = yield* seedFeed(harness, alice.owner, { title: 'Empty' });
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      yield* seedFeedItems(harness, alice.owner, first.id, [
        {},
        { read: true },
        {},
      ]);
      yield* seedFeedItems(harness, alice.owner, second.id, [{}, {}, {}]);
      yield* seedFeedItems(harness, bob.owner, theirs.id, [{}]);

      const mine = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, alice)
      );
      const theirsResponse = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, bob)
      );
      const savedUnread = yield* Effect.promise(() =>
        harness.call({
          path: '/api/library/saved-pages/unread',
          cookie: alice.cookie,
        })
      );

      expect(mine.status).toBe(200);
      const counts = yield* Effect.promise(() => readUnreadFeeds(mine));
      expect(counts.feeds.map((feed) => [feed.feedId, feed.count])).toEqual([
        [first.id, 2],
        [second.id, 3],
      ]);
      expect(counts.feeds.some((feed) => feed.feedId === empty.id)).toBe(false);
      expect(
        (yield* Effect.promise(() => readUnreadFeeds(theirsResponse))).feeds
      ).toEqual([{ feedId: theirs.id, count: 1 }]);
      expect(
        yield* Effect.promise(() => harness.json<object>(savedUnread))
      ).toEqual({ count: 0 });
    })
  )
);

it.effect('marks feeds read and ignores foreign feed ids', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const first = yield* seedFeed(harness, alice.owner, { title: 'First' });
      const second = yield* seedFeed(harness, alice.owner, { title: 'Second' });
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      yield* seedFeedItems(harness, alice.owner, first.id, [{}, {}]);
      yield* seedFeedItems(harness, alice.owner, second.id, [{}]);
      yield* seedFeedItems(harness, bob.owner, theirs.id, [{}]);

      const response = yield* Effect.promise(() =>
        markFeedsRead(harness, alice, [first.id, theirs.id, unknownId])
      );
      const mine = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, alice)
      );
      const firstUnread = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, {
          feedId: first.id,
          unreadOnly: true,
          limit: 30,
        })
      );
      const theirUnread = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, bob)
      );

      expect(response.status).toBe(200);
      expect(
        yield* Effect.promise(() => harness.json<object>(response))
      ).toEqual({ ok: true });
      expect(yield* Effect.promise(() => readUnreadFeeds(mine))).toEqual({
        feeds: [{ feedId: second.id, count: 1 }],
      });
      expect(
        (yield* Effect.promise(() => readItemPage(firstUnread))).page.items
      ).toEqual([]);
      expect(
        (yield* Effect.promise(() => readUnreadFeeds(theirUnread))).feeds
      ).toEqual([{ feedId: theirs.id, count: 1 }]);
    })
  )
);

it.effect('marking all feed items read leaves saved pages unread', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const feed = yield* seedFeed(harness, alice.owner, { title: 'Mine' });
      const item = yield* seedItem(harness, alice.owner, feed.id);
      yield* seedItem(harness, alice.owner, feed.id);
      const saved = yield* seedSavedPageFromItem(harness, alice.owner, item);
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      yield* seedFeedItems(harness, bob.owner, theirs.id, [{}]);

      const outcome = yield* Effect.promise(() =>
        markAllAndRead(harness, alice)
      );
      const theirUnread = yield* Effect.promise(() =>
        fetchUnreadFeeds(harness, bob)
      );

      expect(outcome.response.status).toBe(200);
      expect(outcome.unread).toEqual({ feeds: [] });
      expect(outcome.itemIds).toEqual([]);
      expect(outcome.savedUnread).toEqual({ count: 1 });
      expect(outcome.saved).toEqual([[saved.id, false]]);
      expect(
        (yield* Effect.promise(() => readUnreadFeeds(theirUnread))).feeds
      ).toEqual([{ feedId: theirs.id, count: 1 }]);
    })
  )
);
