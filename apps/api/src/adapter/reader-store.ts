import { Context, Effect, Layer, Semaphore } from 'effect';
import * as Port from '../../../../packages/business/src/port/reader-store.ts';
import { Database } from '../infrastructure/db';
import { makeArticles } from './article-store';
import { makeSubscriptions } from './subscription-store';

export { DEFAULT_RETENTION } from './subscription-store';

export const readerStoreSchema = `
DEFINE TABLE IF NOT EXISTS article SCHEMALESS;
DEFINE INDEX IF NOT EXISTS article_owner_feed ON article FIELDS owner, feedId;
DEFINE INDEX IF NOT EXISTS article_owner_feed_published ON article FIELDS owner, feedId, publishedAt;
DEFINE TABLE IF NOT EXISTS feed SCHEMALESS;
DEFINE INDEX IF NOT EXISTS reader_feed_owner ON feed FIELDS owner;
DEFINE TABLE IF NOT EXISTS reader_setting SCHEMALESS;
DEFINE INDEX IF NOT EXISTS reader_setting_owner ON reader_setting FIELDS owner UNIQUE;
DEFINE TABLE IF NOT EXISTS reader_credential SCHEMALESS;
DEFINE INDEX IF NOT EXISTS reader_credential_owner ON reader_credential FIELDS owner UNIQUE;
`;

export class ReaderStoreConcurrency extends Context.Service<
  ReaderStoreConcurrency,
  Semaphore.Semaphore
>()('reader/ReaderStoreConcurrency') {}

export const ReaderStoreConcurrencyLive = Layer.effect(
  ReaderStoreConcurrency,
  Semaphore.make(1)
);

export const ArticlesLive = Layer.effect(
  Port.Articles,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeArticles(db, lock);
  })
);

export const SubscriptionsLive = Layer.effect(
  Port.Subscriptions,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeSubscriptions(db, lock);
  })
);

export const ReaderStoreLive = Layer.merge(
  ArticlesLive,
  SubscriptionsLive
).pipe(Layer.provide(ReaderStoreConcurrencyLive));
