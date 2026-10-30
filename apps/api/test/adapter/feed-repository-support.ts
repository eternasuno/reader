import {
  type FeedRepository,
  type ParsedFeed,
  prepareInitialImport,
  prepareRefreshImport,
} from '@reader/business';
import { Effect, Layer } from 'effect';
import type { Surreal } from 'surrealdb';
import { FeedRepositoryLive } from '../../src/adapter/feed-repository';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { feedsSchema } from '../../src/infrastructure/feeds';

export const makeParsed = (count: number, offset = 0) => ({
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

export const createSubscribedFeed = (
  repository: FeedRepository['Service'],
  owner: string,
  url: string,
  parsed: ParsedFeed,
  now: string
) =>
  repository.createSubscribed(
    owner,
    url,
    prepareInitialImport(parsed, now),
    now
  );

export const syncFeed = (
  repository: FeedRepository['Service'],
  owner: string,
  key: string,
  parsed: ParsedFeed,
  now: string
) => repository.sync(owner, key, prepareRefreshImport(parsed, now), now);

export const runWithClient = <A, E>(
  check: (db: Surreal) => Effect.Effect<A, E, FeedRepository>
) =>
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
        Effect.andThen(check(db)),
        Effect.provide(
          FeedRepositoryLive.pipe(Layer.provide(Layer.succeed(Database, db)))
        )
      ),
    (db) => Effect.promise(() => db.close())
  );

export const createEmptyFeed = (
  repository: FeedRepository['Service'],
  owner: string,
  url: string,
  now: string
) => createSubscribedFeed(repository, owner, url, makeParsed(0), now);

export const runWithDatabase = <A, E>(
  check: Effect.Effect<A, E, FeedRepository>
) => runWithClient(() => check);
