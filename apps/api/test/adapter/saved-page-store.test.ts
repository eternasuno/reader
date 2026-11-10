// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each block is one cohesive integration scenario.
import { expect, it } from '@effect/vitest';
import {
  SavedPageId,
  type SavedPageQuery,
  SavedPageRepository,
} from '@reader/business';
import { Effect, Option } from 'effect';
import {
  dateTime,
  hash,
  ids,
  owner,
  query,
  runCheck,
  savedPage,
  sorted,
} from './store-support';

const pageQuery = (
  overrides: Partial<SavedPageQuery> = {}
): SavedPageQuery => ({
  limit: 100,
  ...overrides,
});

it.effect('stores and reads publication dates as native datetimes', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const page = savedPage('alice', 'native');
      yield* pages.create([page]);

      expect(
        yield* query(
          db,
          'SELECT VALUE type::is_datetime(publishedAt) FROM saved_page;'
        )
      ).toEqual([true]);
      expect(yield* pages.find(alice, page.id)).toEqual(Option.some(page));
    })
  )
);

it.effect('creates idempotently and keeps the stored read state', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const first = savedPage('alice', 'first');
      const second = savedPage('alice', 'second');

      expect(yield* pages.create([])).toEqual([]);
      expect(yield* pages.create([first, first, second])).toEqual([
        first.id,
        second.id,
      ]);

      yield* pages.update(alice, [first.id], { read: true });
      expect(yield* pages.create([first])).toEqual([]);
      expect(
        (yield* pages.find(alice, first.id)).pipe(
          Option.map((page) => page.read)
        )
      ).toEqual(Option.some(true));
    })
  )
);

it.effect('isolates saved pages between owners', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const aliceUrl = savedPage('alice', 'shared');
      const bobCopy = savedPage('bob', 'shared');
      yield* pages.create([aliceUrl, bobCopy]);

      expect(yield* ids(pages.list(alice, pageQuery()))).toEqual([aliceUrl.id]);
      expect(yield* ids(pages.list(bob, pageQuery()))).toEqual([bobCopy.id]);
      expect(yield* pages.find(bob, aliceUrl.id)).toEqual(Option.none());

      expect(yield* pages.update(bob, [aliceUrl.id], { read: true })).toEqual(
        []
      );
      yield* pages.remove(bob, [aliceUrl.id]);
      expect(yield* pages.find(alice, aliceUrl.id)).toEqual(
        Option.some(aliceUrl)
      );
      expect(yield* pages.updateAll(bob, { read: true })).toEqual([bobCopy.id]);
      expect(
        (yield* pages.find(alice, aliceUrl.id)).pipe(
          Option.map((page) => page.read)
        )
      ).toEqual(Option.some(false));
    })
  )
);

it.effect('orders ties by descending id with exclusive after', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const hashA = hash('tie-a');
      const hashB = hash('tie-b');
      const lowId = hashA < hashB ? hashA : hashB;
      const highId = hashA < hashB ? hashB : hashA;
      const at = '2026-01-02T00:00:00.000Z';
      const newest = savedPage('alice', 'newest', {
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const tieLow = savedPage('alice', 'low', {
        id: lowId,
        publishedAt: at,
      });
      const tieHigh = savedPage('alice', 'high', {
        id: highId,
        publishedAt: at,
      });
      const oldest = savedPage('alice', 'oldest');
      yield* pages.create([oldest, tieHigh, newest, tieLow]);

      expect(yield* ids(pages.list(alice, pageQuery()))).toEqual([
        newest.id,
        tieHigh.id,
        tieLow.id,
        oldest.id,
      ]);
      expect(
        yield* ids(
          pages.list(
            alice,
            pageQuery({
              after: {
                publishedAt: dateTime(at),
                id: SavedPageId.make(highId),
              },
            })
          )
        )
      ).toEqual([tieLow.id, oldest.id]);
      expect(yield* pages.list(alice, pageQuery({ limit: 2 }))).toHaveLength(2);
    })
  )
);

it.effect('filters by read state and counts unread pages per owner', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const unread = savedPage('alice', 'unread');
      const read = savedPage('alice', 'read', { read: true });
      const another = savedPage('alice', 'another');
      const bobPage = savedPage('bob', 'bob');
      yield* pages.create([unread, read, another, bobPage]);

      expect(yield* ids(pages.list(alice, pageQuery({ read: true })))).toEqual([
        read.id,
      ]);
      expect(
        sorted(yield* ids(pages.list(alice, pageQuery({ read: false }))))
      ).toEqual(sorted([unread.id, another.id]));

      expect(yield* pages.unreadCount(alice)).toBe(2);
      expect(yield* pages.unreadCount(bob)).toBe(1);
      expect(yield* pages.unreadCount(owner('nobody'))).toBe(0);
    })
  )
);

it.effect('updates and removes by id with empty selections as no-ops', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const pages = yield* SavedPageRepository;
      const alice = owner('alice');
      const first = savedPage('alice', 'first');
      const second = savedPage('alice', 'second');
      yield* pages.create([first, second]);

      expect(yield* pages.update(alice, [], { read: true })).toEqual([]);
      expect(yield* pages.update(alice, [first.id], {})).toEqual([]);
      expect(yield* pages.update(alice, [first.id], { read: true })).toEqual([
        first.id,
      ]);
      expect(yield* pages.unreadCount(alice)).toBe(1);

      yield* pages.remove(alice, []);
      expect(yield* ids(pages.list(alice, pageQuery()))).toHaveLength(2);

      expect(yield* pages.updateAll(alice, { read: true })).toHaveLength(2);
      expect(yield* pages.unreadCount(alice)).toBe(0);

      yield* pages.remove(alice, [first.id]);
      expect(yield* ids(pages.list(alice, pageQuery()))).toEqual([second.id]);
    })
  )
);
