import { expect, it } from '@effect/vitest';
import { FeedRepository } from '@reader/business';
import { Effect, Layer } from 'effect';
import { FeedRepositoryLive } from '../../src/adapter/feed-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { feedsSchema } from '../../src/infrastructure/feeds';

const makeParsed = (count: number, offset = 0) => ({
  title: 'News',
  articles: Array.from({ length: count }, (_, index) => {
    const id = offset + index;
    return {
      identity: String(id),
      url: `https://example.com/${id}`,
      title: String(id),
      publishedAt: new Date(id * 1000).toISOString(),
    };
  }),
});

const runWithDatabase = <A, E>(check: Effect.Effect<A, E, FeedRepository>) =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'feeds',
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(() => db.query(feedsSchema)).pipe(
        Effect.andThen(check),
        Effect.provide(
          FeedRepositoryLive.pipe(Layer.provide(Layer.succeed(Database, db)))
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

const verifyDescriptions = (
  repository: FeedRepository['Service'],
  key: string,
  article: string,
  parsed: ReturnType<typeof makeParsed>,
  now: string
) =>
  Effect.gen(function* () {
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    const refreshed = {
      ...parsed,
      articles: parsed.articles.map((item) => ({
        ...item,
        description: '<p>Updated</p>',
      })),
    };
    yield* repository.sync('bob', key, refreshed, false, now);
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    yield* repository.sync('alice', key, refreshed, false, now);
    const updated = yield* repository.article('alice', article);
    expect(updated?.description).toBe('<p>Updated</p>');
    expect(updated?.read).toBe(true);
    expect(
      (yield* repository.articles('alice', key, true, 0, 40))[0]?.description
    ).toBe('<p>Updated</p>');
  });

const verifyCoreFlows = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const feed = yield* repository.create(
    'alice',
    'https://example.com/rss',
    'News'
  );
  const key = feed?.key ?? '';
  expect(feed).toBeDefined();
  expect(
    yield* repository.create('alice', 'https://example.com/rss', 'News')
  ).toBeUndefined();
  const parsed = makeParsed(35);
  const now = new Date().toISOString();
  yield* repository.sync('alice', key, parsed, true, now);
  const items = yield* repository.articles('alice', '', false, 0, 40);
  expect(items).toHaveLength(30);
  const article = items[0]?.key ?? '';
  expect(yield* repository.mark('bob', article, true)).toBe(false);
  yield* repository.mark('alice', article, true);
  yield* repository.sync('alice', key, parsed, false, now);
  expect((yield* repository.article('alice', article))?.read).toBe(true);
  yield* verifyDescriptions(repository, key, article, parsed, now);
  expect(yield* repository.articles('bob', '', false, 0, 40)).toEqual([]);
  expect(yield* repository.remove('bob', key)).toBe(false);
  expect(yield* repository.remove('alice', key)).toBe(true);
  expect(yield* repository.articles('alice', '', false, 0, 40)).toEqual([]);
});

const verifyRetentionCap = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const feed = yield* repository.create(
    'alice',
    'https://example.com/rss',
    'News'
  );
  const key = feed?.key ?? '';
  yield* repository.sync(
    'alice',
    key,
    makeParsed(500),
    false,
    new Date(600000).toISOString()
  );
  expect(yield* repository.articles('alice', '', false, 0, 600)).toHaveLength(
    500
  );
  yield* repository.sync(
    'alice',
    key,
    makeParsed(500, 500),
    false,
    new Date(1100000).toISOString()
  );
  const retained = yield* repository.articles('alice', '', false, 0, 600);
  expect(retained).toHaveLength(500);
  expect(retained[0]?.title).toBe('999');
  expect(retained[499]?.title).toBe('500');
  expect(yield* repository.remove('alice', key)).toBe(true);
  yield* repository.sync(
    'alice',
    key,
    makeParsed(10),
    false,
    new Date().toISOString()
  );
  expect(yield* repository.articles('alice', '', false, 0, 10)).toEqual([]);
});

it.effect('deduplicates subscriptions and articles, preserves read state', () =>
  runWithDatabase(verifyCoreFlows)
);

it.effect('caps articles at 500 and skips sync after unsubscribe', () =>
  runWithDatabase(verifyRetentionCap)
);
