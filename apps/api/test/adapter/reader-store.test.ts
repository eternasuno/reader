// biome-ignore-all lint/style/noExcessiveLinesPerFile: integration tests share fixtures around one store boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each block is one cohesive integration scenario.
import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import {
  Article,
  ArticleContent,
  ArticleId,
  type ArticleQuery,
  ArticleRepository,
  ArticleTitle,
  Feed,
  FeedId,
  FeedRepository,
  NormalizedUrl,
  OwnerId,
} from '@reader/business';
import { Effect, Layer, Option, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  ReaderStoreLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { createSurreal, Database } from '../../src/infrastructure/db';

type Store = ArticleRepository | FeedRepository | Database;

const hash = (...values: Array<string>) =>
  createHash('sha256').update(JSON.stringify(values)).digest('hex');

const owner = (value: string) => Schema.decodeSync(OwnerId)(value);

const dateTime = (value: string) =>
  Schema.decodeSync(Schema.DateTimeUtcFromString)(value);

const normalizedUrl = Schema.decodeSync(NormalizedUrl);

const changedTitle = Schema.decodeSync(ArticleTitle)('Changed');

const bodyContent = Schema.decodeSync(ArticleContent)('<p>Body</p>');

const emptyContent = Schema.decodeSync(ArticleContent)(undefined);

const feed = (ownerId: string, url: string, updatedAt: string, id?: string) =>
  Schema.decodeSync(Feed)({
    id: id ?? hash(ownerId, url),
    ownerId,
    url,
    title: url,
    updatedAt: new Date(updatedAt),
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
  Schema.decodeSync(Article)({
    id: options.id ?? hash(ownerId, seed),
    ownerId,
    ...(options.feedId === undefined ? {} : { feedId: options.feedId }),
    title: options.title ?? seed,
    publishedAt: new Date(options.publishedAt ?? '2026-01-01T00:00:00.000Z'),
    read: options.read ?? false,
  });

const hashA = hash('tie-a');

const hashB = hash('tie-b');

const tieFirstId = Schema.decodeSync(ArticleId)(hashA < hashB ? hashA : hashB);

const tieSecondId = Schema.decodeSync(ArticleId)(hashA < hashB ? hashB : hashA);

const missingFeedId = Schema.decodeSync(FeedId)(hash('missing'));

const missingArticleId = Schema.decodeSync(ArticleId)(hash('missing'));

const pageQuery = (limit = 100): ArticleQuery => ({
  filter: 'all',
  limit,
});

const sorted = (values: ReadonlyArray<string>) => [...values].sort();

const sortedFeeds = (
  feeds: ReadonlyArray<{ readonly id: string; readonly count: number }>
) => [...feeds].sort((left, right) => left.id.localeCompare(right.id));

const ids = <A extends { readonly id: string }, E, R>(
  effect: Effect.Effect<ReadonlyArray<A>, E, R>
) => effect.pipe(Effect.map((items) => items.map((item) => item.id)));

const query = <A>(
  db: Surreal,
  sql: string,
  bindings: Record<string, unknown> = {}
) =>
  Effect.promise(async () => {
    const [rows] = await db.query<[Array<A>]>(sql, bindings);

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

it.effect('stores and reads publication dates as native datetimes', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const alice = owner('alice');
      const item = article('alice', 'native');
      yield* articles.create(alice, [item]);
      expect(
        yield* query(
          db,
          'SELECT VALUE type::is_datetime(publishedAt) FROM article;'
        )
      ).toEqual([true]);
      expect(yield* articles.find(alice, item.id)).toEqual(Option.some(item));
    })
  )
);

it.effect('creates subscriptions idempotently with owner-scoped identity', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const url = 'https://example.com/feed.xml';
      const now = '2026-01-01T00:00:00.000Z';
      const aliceFeed = feed('alice', url, now);
      const bobFeed = feed('bob', url, now);

      expect(
        yield* subscriptions.create(alice, [
          aliceFeed,
          aliceFeed,
          feed('alice', url, now, hash('alternate')),
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

it.effect('batches feed writes with owner protection and empty no-ops', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const now = '2026-01-01T00:00:00.000Z';
      const aliceFirst = feed('alice', 'https://example.com/first.xml', now);
      const aliceSecond = feed('alice', 'https://example.com/second.xml', now);
      const bobFirst = feed('bob', 'https://example.com/first.xml', now);

      expect(
        yield* subscriptions.create(alice, [aliceFirst, aliceSecond])
      ).toEqual([aliceFirst.id, aliceSecond.id]);
      expect(yield* subscriptions.create(bob, [bobFirst])).toEqual([
        bobFirst.id,
      ]);
      expect(yield* subscriptions.list(alice)).toEqual([
        aliceFirst,
        aliceSecond,
      ]);
      expect(
        yield* subscriptions.create(alice, [aliceFirst, aliceSecond])
      ).toEqual([]);
      yield* articles.create(alice, [
        article('alice', 'first', { feedId: aliceFirst.id }),
        article('alice', 'second', { feedId: aliceSecond.id }),
      ]);

      const renamed = {
        ...aliceFirst,
        title: 'Renamed',
        updatedAt: dateTime('2026-01-02T00:00:00.000Z'),
      };
      const retitled = { ...aliceSecond, title: 'Second' };
      yield* subscriptions.update(alice, [
        {
          id: aliceFirst.id,
          feedPatch: {
            title: renamed.title,
            updatedAt: renamed.updatedAt,
          },
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
      expect(yield* subscriptions.list(alice)).toEqual([renamed, movedSecond]);
      expect(yield* subscriptions.list(bob)).toEqual([bobFirst]);

      yield* subscriptions.remove(alice, []);
      expect(yield* subscriptions.list(alice)).toHaveLength(2);

      yield* subscriptions.remove(alice, [aliceFirst.id, aliceSecond.id]);
      expect(yield* subscriptions.list(alice)).toEqual([]);
      expect(yield* subscriptions.list(bob)).toEqual([bobFirst]);
      expect(
        yield* articles.listFeeds(alice, Option.none(), pageQuery())
      ).toEqual([]);
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

it.effect(
  'unsubscribes transactions with later copies and owner isolation',
  () =>
    runCheck((db) =>
      Effect.gen(function* () {
        const articles = yield* ArticleRepository;
        const subscriptions = yield* FeedRepository;
        const alice = owner('alice');
        const bob = owner('bob');
        const now = '2026-01-01T00:00:00.000Z';
        const aliceFeed = feed('alice', 'https://example.com/a.xml', now);
        const bobFeed = feed('bob', 'https://example.com/b.xml', now);
        yield* subscriptions.create(alice, [aliceFeed]);
        yield* subscriptions.create(bob, [bobFeed]);
        const feedItem = article('alice', 'feed', { feedId: aliceFeed.id });
        const later = article('alice', 'later', {
          publishedAt: '2026-01-02T00:00:00.000Z',
        });
        const bobItem = article('bob', 'feed', { feedId: bobFeed.id });
        yield* articles.create(alice, [feedItem, later]);
        yield* articles.create(bob, [bobItem]);

        yield* subscriptions.remove(alice, [aliceFeed.id]);

        expect(yield* subscriptions.find(alice, aliceFeed.id)).toEqual(
          Option.none()
        );
        expect(yield* articles.find(alice, feedItem.id)).toEqual(Option.none());
        expect(yield* articles.find(alice, later.id)).toEqual(
          Option.some(later)
        );
        expect(
          yield* articles.listFeeds(alice, Option.none(), pageQuery())
        ).toEqual([]);
        expect(
          yield* articles.listFeeds(
            alice,
            Option.some([aliceFeed.id]),
            pageQuery()
          )
        ).toEqual([]);
        expect(yield* articles.listLater(alice, pageQuery())).toEqual([later]);
        expect(
          yield* articles.listFeeds(bob, Option.none(), pageQuery())
        ).toEqual([bobItem]);
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

it.effect(
  'scopes listings to all feed articles, empty selections, and selected feeds',
  () =>
    runCheck(() =>
      Effect.gen(function* () {
        const articles = yield* ArticleRepository;
        const subscriptions = yield* FeedRepository;
        const alice = owner('alice');
        const bob = owner('bob');
        const now = '2026-01-01T00:00:00.000Z';
        const aliceFirst = feed('alice', 'https://example.com/one.xml', now);
        const aliceSecond = feed('alice', 'https://example.com/two.xml', now);
        const bobFeed = feed('bob', 'https://example.com/bob.xml', now);
        yield* subscriptions.create(alice, [aliceFirst, aliceSecond]);
        yield* subscriptions.create(bob, [bobFeed]);
        const first = article('alice', 'select-first', {
          feedId: aliceFirst.id,
        });
        const second = article('alice', 'select-second', {
          feedId: aliceSecond.id,
          publishedAt: '2026-01-02T00:00:00.000Z',
        });
        const later = article('alice', 'select-later', {
          publishedAt: '2026-01-03T00:00:00.000Z',
        });
        const bobItem = article('bob', 'select-first', {
          feedId: bobFeed.id,
        });
        yield* articles.create(alice, [first, second, later]);
        yield* articles.create(bob, [bobItem]);

        expect(
          yield* ids(articles.listFeeds(alice, Option.none(), pageQuery()))
        ).toEqual([second.id, first.id]);
        expect(
          yield* ids(
            articles.listFeeds(alice, Option.none(), {
              ...pageQuery(),
              filter: 'unread',
            })
          )
        ).toEqual([second.id, first.id]);
        expect(
          yield* ids(articles.listFeeds(alice, Option.some([]), pageQuery()))
        ).toEqual([]);
        expect(
          yield* ids(articles.listFeeds(bob, Option.some([]), pageQuery()))
        ).toEqual([]);
        expect(yield* ids(articles.listLater(alice, pageQuery()))).toEqual([
          later.id,
        ]);
        expect(
          yield* ids(articles.listLater(alice, { ...pageQuery(), limit: 1 }))
        ).toEqual([later.id]);
        expect(
          yield* ids(
            articles.listFeeds(alice, Option.some([aliceFirst.id]), pageQuery())
          )
        ).toEqual([first.id]);
        expect(
          yield* ids(
            articles.listFeeds(
              alice,
              Option.some([aliceFirst.id, aliceSecond.id]),
              pageQuery()
            )
          )
        ).toEqual([second.id, first.id]);
        expect(
          yield* ids(
            articles.listFeeds(alice, Option.some([bobFeed.id]), pageQuery())
          )
        ).toEqual([]);
        expect(
          yield* ids(
            articles.listLater(alice, { ...pageQuery(), filter: 'unread' })
          )
        ).toEqual([later.id]);
        expect(
          yield* ids(articles.listFeeds(bob, Option.none(), pageQuery()))
        ).toEqual([bobItem.id]);
      })
    )
);

it.effect('writes atomically and preserves duplicates and read state', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/batch.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(alice, [subscribed]);
      const valid = article('alice', 'valid', { feedId: subscribed.id });
      const invalid = article('alice', 'invalid', { feedId: missingFeedId });

      const error = yield* Effect.flip(
        articles.create(alice, [valid, invalid])
      );
      expect(error._tag).toBe('ArticleRepositoryError');
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
      expect(
        yield* articles.updateByArticleIds(alice, [first.id], { read: true })
      ).toEqual([first.id]);
      expect(
        yield* articles.create(alice, [
          {
            ...first,
            title: changedTitle,
            read: false,
          },
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
      expect(
        yield* articles.listFeeds(alice, Option.none(), pageQuery())
      ).toHaveLength(4);
      expect(yield* articles.create(alice, [])).toEqual([]);
    })
  )
);

it.effect('orders ties and applies inclusive through and exclusive after', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/tie.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(alice, [subscribed]);
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
      expect(
        yield* ids(articles.listFeeds(alice, Option.none(), pageQuery()))
      ).toEqual(expected);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), {
            ...pageQuery(),
            filter: 'unread',
          })
        )
      ).toEqual([newest.id, tieFirstId]);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), {
            ...pageQuery(),
            filter: 'read',
          })
        )
      ).toEqual([tieSecondId, oldest.id]);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), {
            ...pageQuery(),
            after: {
              publishedAt: '2026-01-03T00:00:00.000Z',
              id: tieFirstId,
            },
          })
        )
      ).toEqual([tieSecondId, oldest.id]);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), {
            ...pageQuery(),
            through: {
              publishedAt: '2026-01-03T00:00:00.000Z',
              id: tieSecondId,
            },
          })
        )
      ).toEqual([newest.id, tieFirstId, tieSecondId]);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), {
            ...pageQuery(),
            after: {
              publishedAt: '2026-01-02T00:00:00.000Z',
              id: oldest.id,
            },
          })
        )
      ).toEqual([]);
      expect(
        yield* ids(
          articles.listFeeds(alice, Option.none(), { ...pageQuery(), limit: 2 })
        )
      ).toEqual(expected.slice(0, 2));
    })
  )
);

it.effect(
  'merges unread counts over later and feeds with owner isolation',
  () =>
    runCheck(() =>
      Effect.gen(function* () {
        const articles = yield* ArticleRepository;
        const subscriptions = yield* FeedRepository;
        const alice = owner('alice');
        const bob = owner('bob');
        const now = '2026-01-01T00:00:00.000Z';
        const firstFeed = feed('alice', 'https://example.com/one.xml', now);
        const secondFeed = feed('alice', 'https://example.com/two.xml', now);
        const readFeed = feed('alice', 'https://example.com/three.xml', now);
        const bobFeed = feed('bob', 'https://example.com/bob.xml', now);
        yield* subscriptions.create(alice, [firstFeed, secondFeed, readFeed]);
        yield* subscriptions.create(bob, [bobFeed]);
        const firstUnread = article('alice', 'first-unread', {
          feedId: firstFeed.id,
        });
        const firstSecondUnread = article('alice', 'first-second-unread', {
          feedId: firstFeed.id,
          publishedAt: '2026-01-02T00:00:00.000Z',
        });
        const secondUnread = article('alice', 'second-unread', {
          feedId: secondFeed.id,
        });
        const alreadyRead = article('alice', 'already-read', {
          feedId: readFeed.id,
          read: true,
        });
        const laterUnread = article('alice', 'later-unread');
        const bobUnread = article('bob', 'bob-unread', { feedId: bobFeed.id });
        yield* articles.create(alice, [
          firstUnread,
          firstSecondUnread,
          secondUnread,
          alreadyRead,
          laterUnread,
        ]);
        yield* articles.create(bob, [bobUnread]);

        const aliceCounts = yield* articles.unreadCounts(alice);
        expect(aliceCounts.later).toBe(1);
        expect(aliceCounts.feedsTotal).toBe(3);
        expect(sortedFeeds(aliceCounts.feeds)).toEqual(
          sortedFeeds([
            { id: firstFeed.id, count: 2 },
            { id: secondFeed.id, count: 1 },
          ])
        );
        expect(yield* articles.unreadCounts(bob)).toEqual({
          later: 0,
          feedsTotal: 1,
          feeds: [{ id: bobFeed.id, count: 1 }],
        });

        expect(
          yield* articles.updateByArticleIds(alice, [], { read: true })
        ).toEqual([]);
        expect((yield* articles.unreadCounts(alice)).feedsTotal).toBe(3);

        expect(
          yield* articles.updateFeeds(alice, Option.some([]), { read: true })
        ).toEqual([]);
        expect((yield* articles.unreadCounts(alice)).feedsTotal).toBe(3);
        expect((yield* articles.unreadCounts(bob)).feedsTotal).toBe(1);

        expect(
          sorted(
            yield* articles.updateFeeds(alice, Option.some([firstFeed.id]), {
              read: true,
            })
          )
        ).toEqual(sorted([firstUnread.id, firstSecondUnread.id]));
        expect(yield* articles.unreadCounts(alice)).toEqual({
          later: 1,
          feedsTotal: 1,
          feeds: [{ id: secondFeed.id, count: 1 }],
        });

        expect(
          sorted(
            yield* articles.updateFeeds(alice, Option.none(), { read: true })
          )
        ).toEqual(
          sorted([
            firstUnread.id,
            firstSecondUnread.id,
            secondUnread.id,
            alreadyRead.id,
          ])
        );
        expect(yield* articles.unreadCounts(alice)).toEqual({
          later: 1,
          feedsTotal: 0,
          feeds: [],
        });

        expect(yield* articles.updateLater(alice, { read: true })).toEqual([
          laterUnread.id,
        ]);
        expect(yield* articles.unreadCounts(alice)).toEqual({
          later: 0,
          feedsTotal: 0,
          feeds: [],
        });
        expect(yield* articles.unreadCounts(bob)).toEqual({
          later: 0,
          feedsTotal: 1,
          feeds: [{ id: bobFeed.id, count: 1 }],
        });
      })
    )
);

it.effect('applies partial article patches and clears extracted content', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const alice = owner('alice');
      const bob = owner('bob');
      const item = article('alice', 'patch');
      const bobItem = article('bob', 'patch');
      yield* articles.create(alice, [item]);
      yield* articles.create(bob, [bobItem]);

      expect(
        yield* articles.updateByArticleIds(alice, [item.id], { read: true })
      ).toEqual([item.id]);
      expect(yield* articles.find(alice, item.id)).toEqual(
        Option.some({ ...item, read: true })
      );

      expect(
        yield* articles.updateByArticleIds(alice, [item.id], {
          extractedContent: bodyContent,
        })
      ).toEqual([item.id]);
      expect(yield* articles.find(alice, item.id)).toEqual(
        Option.some({
          ...item,
          read: true,
          extractedContent: bodyContent,
        })
      );

      expect(
        yield* articles.updateByArticleIds(alice, [item.id], {
          extractedContent: emptyContent,
        })
      ).toEqual([item.id]);
      expect(yield* articles.find(alice, item.id)).toEqual(
        Option.some({ ...item, read: true })
      );

      expect(
        yield* articles.updateByArticleIds(alice, [], { read: true })
      ).toEqual([]);
      expect(
        yield* articles.updateByArticleIds(alice, [missingArticleId], {
          read: true,
        })
      ).toEqual([]);
      expect(
        yield* articles.updateByArticleIds(alice, [bobItem.id], {
          read: true,
        })
      ).toEqual([]);
      expect(yield* articles.find(bob, bobItem.id)).toEqual(
        Option.some(bobItem)
      );
    })
  )
);

it.effect('inventories, retains, and extracts articles', () =>
  runCheck(() =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/retain.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(alice, [subscribed]);
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
      expect(
        yield* ids(articles.listFeeds(alice, Option.none(), pageQuery()))
      ).toEqual([third.id, second.id]);
      expect(yield* articles.find(alice, second.id)).toEqual(
        Option.some({ ...second, read: true })
      );
      expect(yield* articles.find(alice, later.id)).toEqual(Option.some(later));
      yield* articles.retain(alice, subscribed.id, []);
      expect(
        yield* articles.listFeeds(alice, Option.none(), pageQuery())
      ).toEqual([]);
      expect(yield* articles.listLater(alice, pageQuery())).toEqual([later]);

      expect(
        yield* articles.updateByArticleIds(alice, [later.id], {
          extractedContent: bodyContent,
        })
      ).toEqual([later.id]);
      expect(yield* articles.find(alice, later.id)).toEqual(
        Option.some({
          ...later,
          extractedContent: bodyContent,
        })
      );
      expect(
        yield* articles.updateByArticleIds(alice, [missingArticleId], {
          extractedContent: bodyContent,
        })
      ).toEqual([]);
    })
  )
);

it.effect(
  'removes later copies in bulk without touching subscribed articles',
  () =>
    runCheck(() =>
      Effect.gen(function* () {
        const articles = yield* ArticleRepository;
        const subscriptions = yield* FeedRepository;
        const alice = owner('alice');
        const bob = owner('bob');
        const now = '2026-01-01T00:00:00.000Z';
        const subscribed = feed('alice', 'https://example.com/bulk.xml', now);
        const bobFeed = feed('bob', 'https://example.com/bob.xml', now);
        yield* subscriptions.create(alice, [subscribed]);
        yield* subscriptions.create(bob, [bobFeed]);
        const kept = article('alice', 'bulk-kept');
        const removedFirst = article('alice', 'bulk-remove-a', {
          publishedAt: '2026-01-02T00:00:00.000Z',
        });
        const removedSecond = article('alice', 'bulk-remove-b', {
          publishedAt: '2026-01-03T00:00:00.000Z',
        });
        const feedItem = article('alice', 'bulk-feed', {
          feedId: subscribed.id,
        });
        const bobLater = article('bob', 'bulk-kept');
        yield* articles.create(alice, [
          kept,
          removedFirst,
          removedSecond,
          feedItem,
        ]);
        yield* articles.create(bob, [bobLater]);

        yield* articles.removeLater(alice, []);
        expect(yield* articles.find(alice, removedFirst.id)).toEqual(
          Option.some(removedFirst)
        );

        yield* articles.removeLater(alice, [
          removedFirst.id,
          removedSecond.id,
          feedItem.id,
        ]);
        expect(yield* articles.find(alice, removedFirst.id)).toEqual(
          Option.none()
        );
        expect(yield* articles.find(alice, removedSecond.id)).toEqual(
          Option.none()
        );
        expect(yield* articles.find(alice, feedItem.id)).toEqual(
          Option.some(feedItem)
        );
        expect(yield* articles.find(alice, kept.id)).toEqual(Option.some(kept));
        expect(yield* articles.find(bob, bobLater.id)).toEqual(
          Option.some(bobLater)
        );
      })
    )
);

it.effect('serializes feed deletion with article writes without orphans', () =>
  runCheck((db) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;
      const subscriptions = yield* FeedRepository;
      const alice = owner('alice');
      const subscribed = feed(
        'alice',
        'https://example.com/race.xml',
        '2026-01-01T00:00:00.000Z'
      );
      yield* subscriptions.create(alice, [subscribed]);
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
          Effect.result(subscriptions.remove(alice, [subscribed.id])),
          ...writes.map((item) =>
            Effect.result(articles.create(alice, [item]))
          ),
        ],
        { concurrency: 'unbounded' }
      );

      expect(yield* subscriptions.find(alice, subscribed.id)).toEqual(
        Option.none()
      );
      expect(
        yield* articles.listFeeds(alice, Option.none(), pageQuery())
      ).toEqual([]);
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
