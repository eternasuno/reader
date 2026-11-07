// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each block is one cohesive integration scenario.
import { expect, it } from '@effect/vitest';
import {
  FeedItemRepository,
  FeedRepository,
  NormalizedUrl,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import {
  dateTime,
  feed,
  feedItem,
  hash,
  owner,
  query,
  runCheck,
} from './store-support';

const normalizedUrl = Schema.decodeSync(NormalizedUrl);

const NOW = '2026-01-01T00:00:00.000Z';

it.effect('creates subscriptions idempotently with owner-scoped identity', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const url = 'https://example.com/feed.xml';
      const aliceFeed = feed('alice', url, NOW);
      const bobFeed = feed('bob', url, NOW);

      expect(
        yield* subscriptions.create(alice, [
          aliceFeed,
          aliceFeed,
          feed('alice', url, NOW, hash('alternate')),
        ])
      ).toEqual([aliceFeed.id]);
      expect(yield* subscriptions.create(bob, [bobFeed])).toEqual([bobFeed.id]);
      expect(
        yield* query(db, 'SELECT VALUE type::is_datetime(updatedAt) FROM feed;')
      ).toEqual([true, true]);
      expect(yield* subscriptions.create(alice, [])).toEqual([]);
      expect(yield* subscriptions.list(alice)).toEqual([aliceFeed]);
      expect(yield* subscriptions.list(bob)).toEqual([bobFeed]);
      expect(yield* subscriptions.find(alice, aliceFeed.id)).toEqual(
        Option.some(aliceFeed)
      );
      expect(yield* subscriptions.find(bob, aliceFeed.id)).toEqual(
        Option.none()
      );
      expect(
        yield* query(
          db,
          'SELECT VALUE id FROM feed WHERE owner = $owner AND feedId = $id;',
          { owner: 'alice', id: aliceFeed.id }
        )
      ).toEqual([aliceFeed.id]);
    })
  )
);

it.effect('batches feed updates with owner protection and empty no-ops', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const aliceFirst = feed('alice', 'https://example.com/first.xml', NOW);
      const aliceSecond = feed('alice', 'https://example.com/second.xml', NOW);
      const bobFirst = feed('bob', 'https://example.com/first.xml', NOW);

      yield* subscriptions.create(alice, [aliceFirst, aliceSecond]);
      yield* subscriptions.create(bob, [bobFirst]);
      expect(
        yield* subscriptions.create(alice, [aliceFirst, aliceSecond])
      ).toEqual([]);

      const renamed = {
        ...aliceFirst,
        title: 'Renamed',
        updatedAt: dateTime('2026-01-02T00:00:00.000Z'),
      };
      const retitled = { ...aliceSecond, title: 'Second' };
      yield* subscriptions.update(alice, [
        {
          id: aliceFirst.id,
          feedPatch: { title: renamed.title, updatedAt: renamed.updatedAt },
        },
        { id: aliceSecond.id, feedPatch: { title: retitled.title } },
      ]);
      expect(yield* subscriptions.list(alice)).toEqual([renamed, retitled]);
      expect(
        yield* query(
          db,
          'SELECT VALUE updatedAt FROM feed WHERE feedId = $id;',
          {
            id: aliceFirst.id,
          }
        )
      ).toEqual([new Date('2026-01-02T00:00:00.000Z')]);

      const movedSecond = {
        ...retitled,
        url: normalizedUrl('https://example.com/moved.xml'),
      };
      yield* subscriptions.update(alice, [
        { id: aliceSecond.id, feedPatch: { url: movedSecond.url } },
      ]);
      expect(yield* subscriptions.list(alice)).toEqual([renamed, movedSecond]);

      yield* subscriptions.update(bob, [
        { id: aliceFirst.id, feedPatch: { title: 'Hijacked' } },
      ]);
      yield* subscriptions.update(alice, []);
      yield* subscriptions.remove(bob, [aliceFirst.id]);
      yield* subscriptions.remove(alice, []);
      expect(yield* subscriptions.list(alice)).toEqual([renamed, movedSecond]);
      expect(yield* subscriptions.list(bob)).toEqual([bobFirst]);
    })
  )
);

it.effect('unsubscribing removes only the owner feed items', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const feedItems = yield* FeedItemRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const aliceFeedValue = feed('alice', 'https://example.com/a.xml', NOW);
      const bobFeedValue = feed('bob', 'https://example.com/b.xml', NOW);
      yield* subscriptions.create(alice, [aliceFeedValue]);
      yield* subscriptions.create(bob, [bobFeedValue]);
      const aliceItem = feedItem(aliceFeedValue.id, 'alice-item');
      const bobItem = feedItem(bobFeedValue.id, 'bob-item');
      yield* feedItems.create([aliceItem, bobItem]);

      yield* subscriptions.remove(bob, [aliceFeedValue.id]);
      expect(yield* feedItems.find(aliceFeedValue.id, aliceItem.id)).toEqual(
        Option.some(aliceItem)
      );

      yield* subscriptions.remove(alice, [aliceFeedValue.id]);

      expect(yield* subscriptions.find(alice, aliceFeedValue.id)).toEqual(
        Option.none()
      );
      expect(yield* feedItems.find(aliceFeedValue.id, aliceItem.id)).toEqual(
        Option.none()
      );
      expect(yield* feedItems.find(bobFeedValue.id, bobItem.id)).toEqual(
        Option.some(bobItem)
      );
      expect(
        yield* query<{ total: number }>(
          db,
          'SELECT count() AS total FROM feed_item WHERE feedId = $feedId GROUP ALL;',
          { feedId: aliceFeedValue.id }
        )
      ).toEqual([{ total: 0 }]);
    })
  )
);
