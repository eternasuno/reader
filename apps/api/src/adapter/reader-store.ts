import { Context, Effect, Layer, Semaphore } from 'effect';
import { ArticleRepository } from '../../../../packages/business/src/port/article-repository.ts';
import { FeedRepository } from '../../../../packages/business/src/port/feed-repository.ts';
import { Database } from '../infrastructure/db';
import { makeArticles } from './article-store';
import { makeSubscriptions } from './subscription-store';

export const readerStoreSchema = `
DEFINE TABLE IF NOT EXISTS article SCHEMALESS;
DEFINE FIELD IF NOT EXISTS publishedAt ON TABLE article TYPE datetime;
DEFINE INDEX IF NOT EXISTS article_owner_feed ON article FIELDS owner, feedId;
DEFINE INDEX IF NOT EXISTS article_owner_feed_published ON article FIELDS owner, feedId, publishedAt;
DEFINE TABLE IF NOT EXISTS feed SCHEMALESS;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE feed TYPE datetime;
DEFINE INDEX IF NOT EXISTS reader_feed_owner ON feed FIELDS owner;
DEFINE TABLE IF NOT EXISTS setting SCHEMALESS;
DEFINE INDEX IF NOT EXISTS setting_owner ON setting FIELDS owner UNIQUE;
`;

export class ReaderStoreConcurrency extends Context.Service<
  ReaderStoreConcurrency,
  Semaphore.Semaphore
>()('reader/ReaderStoreConcurrency') {}

export const ReaderStoreConcurrencyLive = Layer.effect(
  ReaderStoreConcurrency,
  Semaphore.make(1)
);

export const ArticleRepositoryLive = Layer.effect(
  ArticleRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeArticles(db, lock);
  })
);

export const FeedRepositoryLive = Layer.effect(
  FeedRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeSubscriptions(db, lock);
  })
);

export const ReaderStoreLive = Layer.merge(
  ArticleRepositoryLive,
  FeedRepositoryLive
).pipe(Layer.provide(ReaderStoreConcurrencyLive));
