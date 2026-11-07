import {
  FeedItemRepository,
  FeedRepository,
  SavedPageRepository,
} from '@reader/business';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { Database } from '../infrastructure/db';
import { makeFeedItems } from './feed-item-store';
import { makeSavedPages } from './saved-page-store';
import { makeSubscriptions } from './subscription-store';

export const readerStoreSchema = `
DEFINE TABLE IF NOT EXISTS feed_item SCHEMALESS;
DEFINE FIELD IF NOT EXISTS publishedAt ON TABLE feed_item TYPE datetime;
DEFINE INDEX IF NOT EXISTS feed_item_feed ON feed_item FIELDS feedId;
DEFINE INDEX IF NOT EXISTS feed_item_feed_published ON feed_item FIELDS feedId, publishedAt;
DEFINE TABLE IF NOT EXISTS saved_page SCHEMALESS;
DEFINE FIELD IF NOT EXISTS publishedAt ON TABLE saved_page TYPE datetime;
DEFINE INDEX IF NOT EXISTS saved_page_owner ON saved_page FIELDS owner;
DEFINE INDEX IF NOT EXISTS saved_page_owner_published ON saved_page FIELDS owner, publishedAt;
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

export const FeedItemRepositoryLive = Layer.effect(
  FeedItemRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeFeedItems(db, lock);
  })
);

export const SavedPageRepositoryLive = Layer.effect(
  SavedPageRepository,
  Effect.gen(function* () {
    const db = yield* Database;
    const lock = yield* ReaderStoreConcurrency;

    return makeSavedPages(db, lock);
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

export const ReaderStoreLive = Layer.mergeAll(
  FeedItemRepositoryLive,
  SavedPageRepositoryLive,
  FeedRepositoryLive
).pipe(Layer.provide(ReaderStoreConcurrencyLive));
