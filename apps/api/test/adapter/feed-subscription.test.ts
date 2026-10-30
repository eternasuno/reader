import { expect, it } from '@effect/vitest';
import { FeedRepository } from '@reader/business';
import { Effect } from 'effect';
import type { Surreal } from 'surrealdb';
import {
  createSubscribedFeed,
  makeParsed,
  runWithClient,
  runWithDatabase,
} from './feed-repository-support';

const verifyIdempotentCreation = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const url = 'https://example.com/retry-rss';
  const parsed = makeParsed(4);
  const createdAt = new Date(1000).toISOString();
  const first = yield* createSubscribedFeed(
    repository,
    'alice',
    url,
    parsed,
    createdAt
  );
  const bobCreatedAt = new Date(2000).toISOString();
  const separate = yield* createSubscribedFeed(
    repository,
    'bob',
    url,
    makeParsed(2),
    bobCreatedAt
  );
  expect(separate.key).not.toBe(first.key);
  const items = yield* repository.articles('alice', '', false, 0, 10);
  const article = items[0]?.key ?? '';
  yield* repository.mark('alice', article, true);
  const retriedAt = new Date(3000).toISOString();
  const retried = yield* createSubscribedFeed(
    repository,
    'alice',
    url,
    parsed,
    retriedAt
  );
  expect(retried).toEqual({ ...first, unreadCount: 3 });
  expect(yield* repository.articles('alice', '', false, 0, 10)).toHaveLength(3);
  expect(yield* repository.articles('alice', '', true, 0, 10)).toHaveLength(1);
});

const verifyConcurrentRetries = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const url = 'https://example.com/concurrent-rss';
  const parsed = makeParsed(4);
  const now = new Date(10000).toISOString();
  const [first, second] = yield* Effect.all(
    [
      createSubscribedFeed(repository, 'alice', url, parsed, now),
      createSubscribedFeed(repository, 'alice', url, parsed, now),
    ],
    { concurrency: 'unbounded' }
  );
  expect(second).toEqual(first);
  expect(yield* repository.articles('alice', '', false, 0, 10)).toHaveLength(4);
  expect(yield* repository.list('alice')).toHaveLength(1);
});

const verifyArticleInsertRollsBack = (db: Surreal) =>
  Effect.gen(function* () {
    const repository = yield* FeedRepository;
    const url = 'https://example.com/conflict-rss';
    const now = new Date(5000).toISOString();
    yield* Effect.promise(() =>
      db.query('DEFINE FIELD url ON feed_article TYPE datetime;')
    );
    const error = yield* Effect.flip(
      createSubscribedFeed(repository, 'alice', url, makeParsed(3), now)
    );
    expect(error._tag).toBe('FeedRepositoryError');
    const [feeds] = yield* Effect.promise(() =>
      db.query<[unknown[]]>('SELECT key FROM feed WHERE owner = "alice";')
    );
    expect(feeds).toEqual([]);
    const [articles] = yield* Effect.promise(() =>
      db.query<[unknown[]]>(
        'SELECT key FROM feed_article WHERE owner = "alice";'
      )
    );
    expect(articles).toEqual([]);
    yield* Effect.promise(() =>
      db.query('REMOVE FIELD IF EXISTS url ON feed_article;')
    );
    expect(
      yield* createSubscribedFeed(repository, 'alice', url, makeParsed(3), now)
    ).toMatchObject({ url, unreadCount: 3 });
  });

it.effect('returns the stored subscription when confirmation is retried', () =>
  runWithDatabase(verifyIdempotentCreation)
);

it.effect('converges concurrent confirmations on one subscription', () =>
  runWithDatabase(verifyConcurrentRetries)
);

it.effect('rolls back the feed row when article insertion fails', () =>
  runWithClient(verifyArticleInsertRollsBack)
);
