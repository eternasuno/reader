import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  fetchFeedItem,
  fetchFeedItems,
  readItem,
  readItemPage,
  seedFeed,
  seedItem,
  sessionFor,
} from './library-feeds-support';
import { makeHarness } from './library-support';

const unknownId = '01234567-89ab-7cde-8123-456789abcdef';

const idOf = (items: ReadonlyArray<{ readonly id: string }>) =>
  items.map((item) => item.id);

it.effect('lists the newest items first and omits empty optional fields', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const one = yield* seedItem(harness, alice.owner, feed.id, {
        title: 'One',
      });
      const two = yield* seedItem(harness, alice.owner, feed.id, {
        title: 'Two',
      });
      const three = yield* seedItem(harness, alice.owner, feed.id, {
        title: 'Three',
      });
      const response = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { limit: 30 })
      );
      const text = yield* Effect.promise(() => response.clone().text());
      const { raw, page } = yield* Effect.promise(() => readItemPage(response));

      expect(response.status).toBe(200);
      expect(idOf(page.items)).toEqual([three.id, two.id, one.id]);
      expect(page.cursor).toBeNull();
      expect(text).not.toContain('"description":null');
      expect(text).not.toContain('"content":null');
      expect(text).not.toContain('"extractedContent":null');
      expect(text).not.toContain('"publishedAt":null');
      expect(
        raw.items.every((item) => !Object.hasOwn(item, 'description'))
      ).toBe(true);
      expect(
        page.items.every(
          (item) =>
            Option.isNone(item.description) &&
            Option.isNone(item.content) &&
            Option.isNone(item.extractedContent) &&
            Option.isNone(item.publishedAt) &&
            item.ownerId === alice.owner &&
            item.read === false
        )
      ).toBe(true);
    })
  )
);

it.effect('filters by feed and treats unknown or foreign feeds as empty', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const first = yield* seedFeed(harness, alice.owner, { title: 'First' });
      const second = yield* seedFeed(harness, alice.owner, { title: 'Second' });
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const older = yield* seedItem(harness, alice.owner, first.id);
      const newer = yield* seedItem(harness, alice.owner, first.id);
      yield* seedItem(harness, alice.owner, second.id);
      yield* seedItem(harness, bob.owner, theirs.id);

      const filtered = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { feedId: first.id, limit: 30 })
      );
      const foreign = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { feedId: theirs.id, limit: 30 })
      );
      const unknown = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { feedId: unknownId, limit: 30 })
      );

      expect(
        idOf((yield* Effect.promise(() => readItemPage(filtered))).page.items)
      ).toEqual([newer.id, older.id]);
      expect(yield* Effect.promise(() => readItemPage(foreign))).toEqual({
        raw: { items: [], cursor: null },
        page: { items: [], cursor: null },
      });
      expect(foreign.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(
        (yield* Effect.promise(() => readItemPage(unknown))).page.items
      ).toEqual([]);
    })
  )
);

it.effect('lists only unread items when asked', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const unreadFirst = yield* seedItem(harness, alice.owner, feed.id);
      const read = yield* seedItem(harness, alice.owner, feed.id, {
        read: true,
      });
      const unreadSecond = yield* seedItem(harness, alice.owner, feed.id);

      const unread = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { unreadOnly: true, limit: 30 })
      );
      const all = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, { limit: 30 })
      );

      expect(
        idOf((yield* Effect.promise(() => readItemPage(unread))).page.items)
      ).toEqual([unreadSecond.id, unreadFirst.id]);
      expect(
        idOf((yield* Effect.promise(() => readItemPage(all))).page.items)
      ).toEqual([unreadSecond.id, read.id, unreadFirst.id]);
    })
  )
);

it.effect('rejects limits outside the allowed range', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');

      for (const limit of [0, -1, 101]) {
        const response = yield* Effect.promise(() =>
          fetchFeedItems(harness, alice, { limit })
        );
        expect(response.status).toBe(400);
      }

      const missing = yield* Effect.promise(() =>
        fetchFeedItems(harness, alice, {})
      );
      expect(missing.status).toBe(400);

      for (const limit of [1, 100]) {
        const response = yield* Effect.promise(() =>
          fetchFeedItems(harness, alice, { limit })
        );
        expect(response.status).toBe(200);
      }
    })
  )
);

it.effect('pages through items with the returned cursor', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const one = yield* seedItem(harness, alice.owner, feed.id);
      const two = yield* seedItem(harness, alice.owner, feed.id);
      const three = yield* seedItem(harness, alice.owner, feed.id);
      const four = yield* seedItem(harness, alice.owner, feed.id);
      const five = yield* seedItem(harness, alice.owner, feed.id);
      const ids: Array<string> = [];
      let cursor: string | null = null;

      for (let page = 0; page < 3; page += 1) {
        const query: Record<string, string | number> =
          cursor === null ? { limit: 2 } : { limit: 2, cursor };
        const response = yield* Effect.promise(() =>
          fetchFeedItems(harness, alice, query)
        );
        const body = yield* Effect.promise(() => readItemPage(response));

        ids.push(...idOf(body.page.items));
        cursor = body.page.cursor;
      }

      expect(ids).toEqual([five.id, four.id, three.id, two.id, one.id]);
      expect(cursor).toBeNull();
    })
  )
);

it.effect('rejects a malformed cursor', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');

      for (const cursor of [
        'not-a-uuid',
        '01234567-89AB-7CDE-8123-456789ABCDEF',
      ]) {
        const response = yield* Effect.promise(() =>
          fetchFeedItems(harness, alice, { limit: 10, cursor })
        );
        expect(response.status).toBe(400);
      }
    })
  )
);

it.effect('opens an item for its owner and reports others as absent', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const feed = yield* seedFeed(harness, alice.owner);
      const mine = yield* seedItem(harness, alice.owner, feed.id, {
        title: 'Mine',
      });
      const theirs = yield* seedFeed(harness, bob.owner, { title: 'Theirs' });
      const theirItem = yield* seedItem(harness, bob.owner, theirs.id, {
        title: 'Theirs',
      });

      const own = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, mine.id)
      );
      const foreign = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, theirItem.id)
      );
      const missing = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, unknownId)
      );
      const malformed = yield* Effect.promise(() =>
        fetchFeedItem(harness, alice, 'not-a-uuid')
      );

      expect(own.status).toBe(200);
      expect(yield* Effect.promise(() => readItem(own))).toEqual({
        raw: {
          id: mine.id,
          ownerId: alice.owner,
          feedId: feed.id,
          url: mine.url.href,
          title: 'Mine',
          read: false,
        },
        item: expect.objectContaining({ id: mine.id, read: false }),
      });
      expect(yield* Effect.promise(() => readItem(foreign))).toEqual({
        raw: null,
        item: null,
      });
      expect((yield* Effect.promise(() => readItem(missing))).item).toBeNull();
      expect(malformed.status).toBe(400);
    })
  )
);
