// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one store boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each block is one cohesive integration scenario.
import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import * as Model from '../../../../packages/business/src/entity/model.ts';
import * as Port from '../../../../packages/business/src/port/reader-store.ts';
import {
  ReaderStoreLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Store = Port.Articles | Port.Subscriptions | Database;

const hash = (...values: string[]) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

const owner = (value: string) => Schema.decodeSync(Model.OwnerId)(value);

const feed = (ownerId: string, url: string, updatedAt: string, id?: string) =>
  Schema.decodeSync(Model.Feed)({
    id: id ?? hash(ownerId, url),
    ownerId,
    url,
    title: url,
    updatedAt,
  });

const article = (
  ownerId: string,
  seed: string,
  options: {
    readonly id?: string;
    readonly feedId?: string;
    readonly publishedAt?: string;
    readonly read?: boolean;
    readonly title?: string;
  } = {}
) =>
  Schema.decodeSync(Model.Article)({
    id: options.id ?? hash(ownerId, seed),
    ownerId,
    ...(options.feedId === undefined ? {} : { feedId: options.feedId }),
    title: options.title ?? seed,
    publishedAt: options.publishedAt ?? '2026-01-01T00:00:00.000Z',
    read: options.read ?? false,
  });

const hashA = hash('tie-a');
const hashB = hash('tie-b');
const tieFirstId = Schema.decodeSync(Model.ArticleId)(
  hashA < hashB ? hashA : hashB
);
const tieSecondId = Schema.decodeSync(Model.ArticleId)(
  hashA < hashB ? hashB : hashA
);
const missingFeedId = Schema.decodeSync(Model.FeedId)(hash('missing'));
const missingArticleId = Schema.decodeSync(Model.ArticleId)(hash('missing'));

const feedsQuery = (limit = 100): Port.ArticleQuery => ({
  scope: { kind: 'feeds' },
  filter: 'all',
  limit,
});

const laterQuery: Port.ArticleQuery = {
  scope: { kind: 'later' },
  filter: 'all',
  limit: 100,
};

const ids = <A extends { readonly id: string }, E, R>(
  effect: Effect.Effect<readonly A[], E, R>
) => effect.pipe(Effect.map((items) => items.map((item) => item.id)));

const query = <A>(
  db: Surreal,
  sql: string,
  bindings: Record<string, unknown> = {}
) =>
  Effect.promise(async () => {
    const [rows] = await db.query<[A[]]>(sql, bindings);

    return rows;
  });

const runCheck = <A, E>(check: (db: Surreal) => Effect.Effect<A, E, Store>) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: `reader-store-${randomUUID()}`,
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(readerStoreSchema)).pipe(
        Effect.andThen(check(db)),
        Effect.provide(
          Layer.merge(
            ReaderStoreLive.pipe(Layer.provide(Layer.succeed(Database, db))),
            Layer.succeed(Database, db)
          )
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

it.effect('creates subscriptions idempotently with owner-scoped identity', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const bob = owner('bob');
      const url = 'https://example.com/feed.xml';
      const now = '2026-01-01T00:00:00.000Z';
      const aliceFeed = feed('alice', url, now);
      const bobFeed = feed('bob', url, now);

      expect(yield* subscriptions.create(aliceFeed)).toBe(true);
      expect(yield* subscriptions.create(aliceFeed)).toBe(false);
      expect(
        yield* subscriptions.create(feed('alice', url, now, hash('alternate')))
      ).toBe(false);
      expect(yield* subscriptions.create(bobFeed)).toBe(true);
      expect(yield* subscriptions.list(alice)).toEqual([aliceFeed]);
      expect(yield* subscriptions.all).toHaveLength(2);
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

it.effect(
  'unsubscribes transactions with later copies and owner isolation',
  () =>
    runCheck((db) =>
      Effect.gen(function* () {
        const articles = yield* Port.Articles;
        const subscriptions = yield* Port.Subscriptions;
        const alice = owner('alice');
        const bob = owner('bob');
        const now = '2026-01-01T00:00:00.000Z';
        const aliceFeed = feed('alice', 'https://example.com/a.xml', now);
        const bobFeed = feed('bob', 'https://example.com/b.xml', now);
        yield* subscriptions.create(aliceFeed);
        yield* subscriptions.create(bobFeed);
        const feedItem = article('alice', 'feed', { feedId: aliceFeed.id });
        const later = article('alice', 'later', {
          publishedAt: '2026-01-02T00:00:00.000Z',
        });
        const bobItem = article('bob', 'feed', { feedId: bobFeed.id });
        yield* articles.create(alice, [feedItem, later]);
        yield* articles.create(bob, [bobItem]);

        yield* subscriptions.remove(alice, aliceFeed.id);

        expect(yield* subscriptions.find(alice, aliceFeed.id)).toEqual(
          Option.none()
        );
        expect(yield* articles.find(alice, feedItem.id)).toEqual(Option.none());
        expect(yield* articles.find(alice, later.id)).toEqual(
          Option.some(later)
        );
        expect(yield* articles.list(alice, feedsQuery())).toEqual([]);
        expect(yield* articles.list(bob, feedsQuery())).toEqual([bobItem]);
        expect(
          yield* query<{ total: number }>(
            db,
            'SELECT count() AS total FROM article WHERE owner = $owner AND feedId = $feedId GROUP ALL;',
            { owner: 'alice', feedId: aliceFeed.id }
          )
        ).toEqual([{ total: 0 }]);
      })
    )
);

it.effect('writes atomically and preserves duplicates and read state', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* Port.Articles;
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/batch.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(subscribed);
      const valid = article('alice', 'valid', { feedId: subscribed.id });
      const invalid = article('alice', 'invalid', { feedId: missingFeedId });

      const error = yield* Effect.flip(
        articles.create(alice, [valid, invalid])
      );
      expect(error._tag).toBe('ArticleWriteError');
      expect(yield* articles.find(alice, valid.id)).toEqual(Option.none());

      const first = article('alice', 'first', {
        feedId: subscribed.id,
        title: 'Original',
      });
      const second = article('alice', 'second', {
        feedId: subscribed.id,
        publishedAt: '2026-01-02T00:00:00.000Z',
      });
      const third = article('alice', 'third', {
        feedId: subscribed.id,
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const fourth = article('alice', 'fourth', { feedId: subscribed.id });
      expect(yield* articles.create(alice, [first, second])).toEqual([
        first.id,
        second.id,
      ]);
      yield* articles.setRead(alice, [first.id], true);
      expect(
        yield* articles.create(alice, [
          { ...first, title: 'Changed', read: false },
          second,
          third,
        ])
      ).toEqual([third.id]);
      expect(yield* articles.find(alice, first.id)).toEqual(
        Option.some({ ...first, read: true })
      );
      expect(yield* articles.create(alice, [fourth, fourth])).toEqual([
        fourth.id,
      ]);
      expect(yield* articles.list(alice, feedsQuery())).toHaveLength(4);
      expect(yield* articles.create(alice, [])).toEqual([]);
    })
  )
);

it.effect('orders ties and applies inclusive through and exclusive after', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* Port.Articles;
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/tie.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(subscribed);
      const newest = article('alice', 'newest', {
        feedId: subscribed.id,
        publishedAt: '2026-01-04T00:00:00.000Z',
      });
      const tieFirst = article('alice', 'tie-first', {
        id: tieFirstId,
        feedId: subscribed.id,
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const tieSecond = article('alice', 'tie-second', {
        id: tieSecondId,
        feedId: subscribed.id,
        publishedAt: '2026-01-03T00:00:00.000Z',
        read: true,
      });
      const oldest = article('alice', 'oldest', {
        feedId: subscribed.id,
        publishedAt: '2026-01-02T00:00:00.000Z',
        read: true,
      });
      yield* articles.create(alice, [newest, tieFirst, tieSecond, oldest]);

      const expected = [newest.id, tieFirstId, tieSecondId, oldest.id];
      expect(yield* ids(articles.list(alice, feedsQuery()))).toEqual(expected);
      expect(
        yield* ids(articles.list(alice, { ...feedsQuery(), filter: 'unread' }))
      ).toEqual([newest.id, tieFirstId]);
      expect(
        yield* ids(articles.list(alice, { ...feedsQuery(), filter: 'read' }))
      ).toEqual([tieSecondId, oldest.id]);
      expect(
        yield* ids(
          articles.list(alice, {
            ...feedsQuery(),
            after: {
              publishedAt: '2026-01-03T00:00:00.000Z',
              id: tieFirstId,
            },
          })
        )
      ).toEqual([tieSecondId, oldest.id]);
      expect(
        yield* ids(
          articles.list(alice, {
            ...feedsQuery(),
            through: {
              publishedAt: '2026-01-03T00:00:00.000Z',
              id: tieSecondId,
            },
          })
        )
      ).toEqual([newest.id, tieFirstId, tieSecondId]);
      expect(
        yield* ids(
          articles.list(alice, {
            ...feedsQuery(),
            after: {
              publishedAt: '2026-01-02T00:00:00.000Z',
              id: oldest.id,
            },
          })
        )
      ).toEqual([]);
      expect(
        yield* ids(articles.list(alice, { ...feedsQuery(), limit: 2 }))
      ).toEqual(expected.slice(0, 2));
    })
  )
);

it.effect('counts unread scopes and treats empty marks as no-ops', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* Port.Articles;
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const firstFeed = feed(
        'alice',
        'https://example.com/one.xml',
        '2026-01-01T00:00:00.000Z'
      );
      const secondFeed = feed(
        'alice',
        'https://example.com/two.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(firstFeed);
      yield* subscriptions.create(secondFeed);
      const firstUnread = article('alice', 'first-unread', {
        feedId: firstFeed.id,
      });
      const firstRead = article('alice', 'first-read', {
        feedId: firstFeed.id,
        read: true,
      });
      const firstSecondUnread = article('alice', 'first-second-unread', {
        feedId: firstFeed.id,
        publishedAt: '2026-01-02T00:00:00.000Z',
      });
      const secondUnread = article('alice', 'second-unread', {
        feedId: secondFeed.id,
      });
      const laterUnread = article('alice', 'later-unread');
      yield* articles.create(alice, [
        firstUnread,
        firstRead,
        firstSecondUnread,
        secondUnread,
        laterUnread,
      ]);

      expect(yield* articles.unreadLater(alice)).toBe(1);
      const counts = yield* articles.unreadFeeds(alice);
      expect(counts.total).toBe(3);
      expect(
        counts.feeds.toSorted((left, right) => left.id.localeCompare(right.id))
      ).toEqual(
        [
          { id: firstFeed.id, count: 2 },
          { id: secondFeed.id, count: 1 },
        ].toSorted((left, right) => left.id.localeCompare(right.id))
      );
      yield* articles.setRead(alice, [], true);
      yield* articles.markFeeds(alice, []);
      expect((yield* articles.unreadFeeds(alice)).total).toBe(3);
      yield* articles.markFeeds(alice, [firstFeed.id]);
      expect((yield* articles.unreadFeeds(alice)).total).toBe(1);
      yield* articles.markLater(alice);
      expect(yield* articles.unreadLater(alice)).toBe(0);
      yield* articles.removeLater(alice, laterUnread.id);
      expect(yield* articles.find(alice, laterUnread.id)).toEqual(
        Option.none()
      );
      yield* articles.removeLater(alice, firstUnread.id);
      expect(yield* articles.find(alice, firstUnread.id)).toEqual(
        Option.some({ ...firstUnread, read: true })
      );
    })
  )
);

it.effect('inventories, retains, extracts, and stores retention', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* Port.Articles;
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const bob = owner('bob');
      const subscribed = feed(
        'alice',
        'https://example.com/retain.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(subscribed);
      const first = article('alice', 'retain-a', { feedId: subscribed.id });
      const second = article('alice', 'retain-b', {
        feedId: subscribed.id,
        publishedAt: '2026-01-02T00:00:00.000Z',
        read: true,
      });
      const third = article('alice', 'retain-c', {
        feedId: subscribed.id,
        publishedAt: '2026-01-03T00:00:00.000Z',
      });
      const later = article('alice', 'retain-later', {
        publishedAt: '2026-01-04T00:00:00.000Z',
      });
      yield* articles.create(alice, [first, second, third, later]);

      expect(yield* articles.inventory(alice, subscribed.id)).toEqual([
        { publishedAt: '2026-01-03T00:00:00.000Z', id: third.id },
        { publishedAt: '2026-01-02T00:00:00.000Z', id: second.id },
        { publishedAt: '2026-01-01T00:00:00.000Z', id: first.id },
      ]);
      yield* articles.retain(alice, subscribed.id, [third.id, second.id]);
      expect(yield* ids(articles.list(alice, feedsQuery()))).toEqual([
        third.id,
        second.id,
      ]);
      expect(yield* articles.find(alice, second.id)).toEqual(
        Option.some({ ...second, read: true })
      );
      expect(yield* articles.find(alice, later.id)).toEqual(Option.some(later));
      yield* articles.retain(alice, subscribed.id, []);
      expect(yield* articles.list(alice, feedsQuery())).toEqual([]);
      expect(yield* articles.list(alice, laterQuery)).toEqual([later]);

      expect(
        yield* articles.saveExtracted(alice, later.id, '<p>Body</p>')
      ).toBe(true);
      expect(yield* articles.find(alice, later.id)).toEqual(
        Option.some({ ...later, extractedContent: '<p>Body</p>' })
      );
      expect(
        yield* articles.saveExtracted(alice, missingArticleId, '<p>Body</p>')
      ).toBe(false);
      expect(yield* subscriptions.retention(alice)).toBe(100);
      expect(yield* subscriptions.retention(bob)).toBe(100);
      yield* subscriptions.setRetention(alice, 42);
      expect(yield* subscriptions.retention(alice)).toBe(42);
      expect(yield* subscriptions.retention(bob)).toBe(100);
    })
  )
);

it.effect('serializes feed deletion with article writes without orphans', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const articles = yield* Port.Articles;
      const subscriptions = yield* Port.Subscriptions;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/race.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(subscribed);
      yield* articles.create(alice, [
        article('alice', 'race-initial', { feedId: subscribed.id }),
      ]);
      const writes = Array.from({ length: 5 }, (_, index) =>
        article('alice', `race-${index}`, {
          feedId: subscribed.id,
          publishedAt: `2026-01-0${index + 2}T00:00:00.000Z`,
        })
      );

      yield* Effect.all(
        [
          Effect.result(subscriptions.remove(alice, subscribed.id)),
          ...writes.map((item) =>
            Effect.result(articles.create(alice, [item]))
          ),
        ],
        { concurrency: 'unbounded' }
      );

      expect(yield* subscriptions.find(alice, subscribed.id)).toEqual(
        Option.none()
      );
      expect(yield* articles.list(alice, feedsQuery())).toEqual([]);
      expect(
        yield* query<{ total: number }>(
          db,
          'SELECT count() AS total FROM article WHERE owner = $owner GROUP ALL;',
          { owner: 'alice' }
        )
      ).toEqual([{ total: 0 }]);
    })
  )
);
