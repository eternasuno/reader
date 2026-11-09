// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one store boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each block is one cohesive integration scenario.
import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  FeedId,
  FeedItemId,
  type FeedItemQuery,
  FeedItemRepository,
  FeedRepository,
  OptionFromOptionalNonEmpty,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  dateTime,
  feed,
  feedItem,
  hash,
  ids,
  owner,
  query,
  runCheck,
  sorted,
} from './store-support';

const NOW = '2026-01-01T00:00:00.000Z';

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const pageQuery = (overrides: Partial<FeedItemQuery> = {}): FeedItemQuery => ({
  limit: 100,
  ...overrides,
});

const missingFeedId = Schema.decodeSync(FeedId)(hash('missing'));

const subscribed = (...urls: Array<string>) =>
  Effect.gen(function* () {
    const subscriptions = yield* FeedRepository;
    const feeds = urls.map((url) => feed('alice', url, NOW));
    yield* subscriptions.create(owner('alice'), feeds);

    return feeds.map((value) => value.id);
  });

it.effect('stores and reads publication dates as native datetimes', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedId = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml'
      );
      const item = feedItem(feedId, 'native');
      yield* feedItems.create([item]);

      expect(
        yield* query(
          db,
          'SELECT VALUE type::is_datetime(publishedAt) FROM feed_item;'
        )
      ).toEqual([true]);
      expect(yield* feedItems.find(item.feedId, item.id)).toEqual(
        Option.some(item)
      );
    })
  )
);

it.effect('creates idempotently and refuses items for a missing feed', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedId = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml'
      );
      const first = feedItem(feedId, 'first');
      const second = feedItem(feedId, 'second');

      expect(yield* feedItems.create([])).toEqual([]);
      expect(yield* feedItems.create([first, first, second])).toEqual([
        first.id,
        second.id,
      ]);

      yield* feedItems.update(first.feedId, [first.id], { read: true });
      expect(yield* feedItems.create([first])).toEqual([]);
      expect(
        (yield* feedItems.find(first.feedId, first.id)).pipe(
          Option.map((item) => item.read)
        )
      ).toEqual(Option.some(true));

      const orphan = feedItem(missingFeedId, 'orphan');
      const error = yield* Effect.flip(
        feedItems.create([feedItem(feedId, 'third'), orphan])
      );
      expect(error._tag).toBe('FeedItemRepositoryError');
      expect(
        yield* query(db, 'SELECT VALUE title FROM feed_item ORDER BY title;')
      ).toEqual(['first', 'second']);
    })
  )
);

it.effect('scopes listings to the selected feeds', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedA = missingFeedId, feedB = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml',
        'https://example.com/b.xml'
      );
      const inA = feedItem(feedA, 'in-a');
      const inB = feedItem(feedB, 'in-b');
      yield* feedItems.create([inA, inB]);

      expect(yield* ids(feedItems.list([], pageQuery()))).toEqual([]);
      expect(yield* ids(feedItems.list([feedA], pageQuery()))).toEqual([
        inA.id,
      ]);
      expect(
        sorted(yield* ids(feedItems.list([feedA, feedB], pageQuery())))
      ).toEqual(sorted([inA.id, inB.id]));
      expect(yield* ids(feedItems.list([missingFeedId], pageQuery()))).toEqual(
        []
      );
    })
  )
);

it.effect('orders ties and applies inclusive through and exclusive after', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedId = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml'
      );
      const feedIds = [feedId];
      const hashA = hash('tie-a');
      const hashB = hash('tie-b');
      const lowId = hashA < hashB ? hashA : hashB;
      const highId = hashA < hashB ? hashB : hashA;
      const at = '2026-01-02T00:00:00.000Z';
      const newest = feedItem(feedId, 'newest', {
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const tieLow = feedItem(feedId, 'low', {
        id: lowId,
        publishedAt: at,
      });
      const tieHigh = feedItem(feedId, 'high', {
        id: highId,
        publishedAt: at,
      });
      const oldest = feedItem(feedId, 'oldest');
      yield* feedItems.create([oldest, tieHigh, newest, tieLow]);

      expect(yield* ids(feedItems.list(feedIds, pageQuery()))).toEqual([
        newest.id,
        tieLow.id,
        tieHigh.id,
        oldest.id,
      ]);
      expect(
        yield* ids(
          feedItems.list(
            feedIds,
            pageQuery({
              after: { publishedAt: dateTime(at), id: FeedItemId.make(lowId) },
            })
          )
        )
      ).toEqual([tieHigh.id, oldest.id]);
      expect(
        yield* ids(
          feedItems.listThrough(feedIds, {
            through: {
              publishedAt: dateTime(at),
              id: FeedItemId.make(highId),
            },
          })
        )
      ).toEqual([newest.id, tieLow.id, tieHigh.id]);
      expect(
        yield* feedItems.list(feedIds, pageQuery({ limit: 2 }))
      ).toHaveLength(2);
    })
  )
);

it.effect('filters by read state', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedId = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml'
      );
      const unread = feedItem(feedId, 'unread');
      const read = feedItem(feedId, 'read', { read: true });
      yield* feedItems.create([unread, read]);

      expect(
        yield* ids(feedItems.list([feedId], pageQuery({ read: false })))
      ).toEqual([unread.id]);
      expect(
        yield* ids(feedItems.list([feedId], pageQuery({ read: true })))
      ).toEqual([read.id]);

      const beforeAll = {
        publishedAt: dateTime('2000-01-01T00:00:00.000Z'),
        id: FeedItemId.make(hash('boundary')),
      };
      expect(
        yield* ids(
          feedItems.listThrough([feedId], { read: false, through: beforeAll })
        )
      ).toEqual([unread.id]);
      expect(
        yield* ids(
          feedItems.listThrough([feedId], { read: true, through: beforeAll })
        )
      ).toEqual([read.id]);
    })
  )
);

it.effect('counts unread items per requested feed', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [
        feedA = missingFeedId,
        feedB = missingFeedId,
        feedC = missingFeedId,
      ] = yield* subscribed(
        'https://example.com/a.xml',
        'https://example.com/b.xml',
        'https://example.com/c.xml'
      );
      yield* feedItems.create([
        feedItem(feedA, 'a1'),
        feedItem(feedA, 'a2'),
        feedItem(feedA, 'a3', { read: true }),
        feedItem(feedB, 'b1'),
        feedItem(feedC, 'c1'),
      ]);

      expect(yield* feedItems.unreadCounts([])).toEqual([]);
      const counts = yield* feedItems.unreadCounts([feedA, feedB]);
      const byFeed = (
        left: { readonly feedId: string },
        right: { readonly feedId: string }
      ) => left.feedId.localeCompare(right.feedId);
      expect([...counts].sort(byFeed)).toEqual(
        [
          { feedId: feedA, count: 2 },
          { feedId: feedB, count: 1 },
        ].sort(byFeed)
      );
    })
  )
);

it.effect('applies partial patches within their feed scope', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedA = missingFeedId, feedB = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml',
        'https://example.com/b.xml'
      );
      const inA = feedItem(feedA, 'in-a');
      const inB = feedItem(feedB, 'in-b');
      yield* feedItems.create([inA, inB]);

      expect(yield* feedItems.update(feedA, [], { read: true })).toEqual([]);
      expect(yield* feedItems.update(feedA, [inA.id], {})).toEqual([]);
      expect(yield* feedItems.update(feedA, [inB.id], { read: true })).toEqual(
        []
      );
      expect(yield* feedItems.update(feedA, [inA.id], { read: true })).toEqual([
        inA.id,
      ]);

      const extracted = decodeContent('<p>Extracted</p>');
      yield* feedItems.update(feedA, [inA.id], {
        extractedContent: extracted,
      });
      expect(
        (yield* feedItems.find(inA.feedId, inA.id)).pipe(
          Option.map((item) => [item.read, item.extractedContent] as const)
        )
      ).toEqual(Option.some([true, extracted]));

      yield* feedItems.update(feedA, [inA.id], {
        extractedContent: Option.none(),
      });
      expect(
        (yield* feedItems.find(inA.feedId, inA.id)).pipe(
          Option.map((item) => [item.read, item.extractedContent] as const)
        )
      ).toEqual(Option.some([true, Option.none()]));

      expect(yield* feedItems.updateByFeeds([], { read: true })).toEqual([]);
      expect(yield* feedItems.updateByFeeds([feedB], { read: true })).toEqual([
        inB.id,
      ]);
      expect(
        (yield* feedItems.find(inB.feedId, inB.id)).pipe(
          Option.map((item) => item.read)
        )
      ).toEqual(Option.some(true));
    })
  )
);

it.effect('inventories and retains items of one feed', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const [feedA = missingFeedId, feedB = missingFeedId] = yield* subscribed(
        'https://example.com/a.xml',
        'https://example.com/b.xml'
      );
      const newest = feedItem(feedA, 'newest', {
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const older = feedItem(feedA, 'older');
      const other = feedItem(feedB, 'other');
      yield* feedItems.create([older, newest, other]);

      expect(
        (yield* feedItems.inventory(feedA)).map((entry) => entry.id)
      ).toEqual([newest.id, older.id]);

      yield* feedItems.retain(feedA, [newest.id]);
      expect(yield* ids(feedItems.list([feedA, feedB], pageQuery()))).toEqual([
        newest.id,
        other.id,
      ]);

      yield* feedItems.retain(feedA, []);
      expect(yield* feedItems.inventory(feedA)).toEqual([]);
      expect(yield* ids(feedItems.list([feedB], pageQuery()))).toEqual([
        other.id,
      ]);
    })
  )
);
