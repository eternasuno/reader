import { expect, it } from '@effect/vitest';
import { DateTime, Effect, Option } from 'effect';
import {
  fetchFeedItems,
  firstOf,
  listFeeds,
  readFeeds,
  readItemPage,
  seedFeed,
  seedItem,
  seedSavedPageFromItem,
  sessionFor,
  unsubscribe,
} from './library-feeds-support';
import { type Harness, makeHarness, type TestSession } from './library-support';

const syncTime = DateTime.fromDateUnsafe(new Date('2026-02-01T10:00:00.000Z'));

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const feedState = async (harness: Harness, session: TestSession) => {
  const feeds = await readFeeds(await listFeeds(harness, session));
  const items = await readItemPage(
    await fetchFeedItems(harness, session, { limit: 30 })
  );

  return {
    feedIds: feeds.page.items.map((feed) => feed.id),
    itemIds: items.page.items.map((item) => item.id),
  };
};

const removeAndRead = async (
  harness: Harness,
  session: TestSession,
  id: string
) => {
  const response = await unsubscribe(harness, session, id);
  const saved = await harness.json<{ items: ReadonlyArray<{ id: string }> }>(
    await harness.call({
      path: '/api/library/saved-pages',
      query: { limit: 10 },
      cookie: session.cookie,
    })
  );

  return {
    response,
    savedIds: saved.items.map((page) => page.id),
    ...(await feedState(harness, session)),
  };
};

it.effect('lists the owner feeds by title then id without a sync time', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const beta = yield* seedFeed(harness, alice.owner, { title: 'Beta' });
      const alphaFirst = yield* seedFeed(harness, alice.owner, {
        title: 'Alpha',
      });
      const alphaSecond = yield* seedFeed(harness, alice.owner, {
        title: 'Alpha',
      });
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Alpha' });

      const response = yield* Effect.promise(() => listFeeds(harness, alice));
      const { raw, page } = yield* Effect.promise(() => readFeeds(response));
      const bobFeeds = yield* Effect.promise(() => listFeeds(harness, bob));

      expect(response.status).toBe(200);
      expect(page.items.map((feed) => feed.id)).toEqual([
        alphaFirst.id,
        alphaSecond.id,
        beta.id,
      ]);
      expect(page.items.map((feed) => feed.title)).toEqual([
        'Alpha',
        'Alpha',
        'Beta',
      ]);
      expect(page.items.every((feed) => feed.ownerId === alice.owner)).toBe(
        true
      );
      expect(page.items.every((feed) => Option.isNone(feed.updatedAt))).toBe(
        true
      );
      expect(raw.every((feed) => !Object.hasOwn(feed, 'updatedAt'))).toBe(true);
      expect(
        (yield* Effect.promise(() => readFeeds(bobFeeds))).page.items.map(
          (feed) => feed.id
        )
      ).toEqual([theirs.id]);
    })
  )
);

it.effect('shows the sync time after the first successful sync', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      yield* harness.repositories.feed.update(alice.owner, [feed.id], {
        updatedAt: Option.some(syncTime),
      });

      const response = yield* Effect.promise(() => listFeeds(harness, alice));
      const { raw, page } = yield* Effect.promise(() => readFeeds(response));

      expect(raw[0]?.updatedAt).toBe('2026-02-01T10:00:00.000Z');
      expect(Option.getOrThrow(firstOf(page.items).updatedAt)).toBe(
        '2026-02-01T10:00:00.000Z'
      );
    })
  )
);

it.effect('lists nothing for an owner without feeds', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const response = yield* Effect.promise(() => listFeeds(harness, alice));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readFeeds(response))).toEqual({
        raw: [],
        page: { items: [] },
      });
    })
  )
);

it.effect('removing a feed cascades its items and keeps saved pages', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const kept = yield* seedFeed(harness, alice.owner, { title: 'Kept' });
      const removed = yield* seedFeed(harness, alice.owner, {
        title: 'Removed',
      });
      yield* seedItem(harness, alice.owner, removed.id);
      const removedItem = yield* seedItem(harness, alice.owner, removed.id);
      const keptItem = yield* seedItem(harness, alice.owner, kept.id);
      const saved = yield* seedSavedPageFromItem(
        harness,
        alice.owner,
        removedItem
      );

      const outcome = yield* Effect.promise(() =>
        removeAndRead(harness, alice, removed.id)
      );

      expect(outcome.response.status).toBe(200);
      expect(
        yield* Effect.promise(() => harness.json<object>(outcome.response))
      ).toEqual({ ok: true });
      expect(outcome.feedIds).toEqual([kept.id]);
      expect(outcome.itemIds).toEqual([keptItem.id]);
      expect(outcome.savedIds).toEqual([saved.id]);
    })
  )
);

it.effect('removing an unknown or foreign feed changes nothing', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const mine = yield* seedFeed(harness, alice.owner, { title: 'Mine' });
      const myItem = yield* seedItem(harness, alice.owner, mine.id);
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const theirItem = yield* seedItem(harness, bob.owner, theirs.id);

      const unknown = yield* Effect.promise(() =>
        unsubscribe(harness, alice, unknownId)
      );
      const foreign = yield* Effect.promise(() =>
        unsubscribe(harness, alice, theirs.id)
      );
      const mineAfter = yield* Effect.promise(() => feedState(harness, alice));
      const theirsAfter = yield* Effect.promise(() => feedState(harness, bob));

      expect(unknown.status).toBe(200);
      expect(foreign.status).toBe(200);
      expect(mineAfter).toEqual({ feedIds: [mine.id], itemIds: [myItem.id] });
      expect(theirsAfter).toEqual({
        feedIds: [theirs.id],
        itemIds: [theirItem.id],
      });
    })
  )
);

it.effect('removing the same feed twice succeeds', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      yield* seedItem(harness, alice.owner, feed.id);

      const first = yield* Effect.promise(() =>
        unsubscribe(harness, alice, feed.id)
      );
      const second = yield* Effect.promise(() =>
        unsubscribe(harness, alice, feed.id)
      );
      const after = yield* Effect.promise(() => feedState(harness, alice));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(after).toEqual({ feedIds: [], itemIds: [] });
    })
  )
);
