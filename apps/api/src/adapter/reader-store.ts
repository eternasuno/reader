import {
  FeedItemRepository,
  FeedRepository,
  SavedPageRepository,
} from '@reader/business';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { Database } from '../infrastructure/db';
import { makeFeedItems } from './feed-item-store';
import { makeFeedRepository } from './feed-store';
import { makeSavedPages } from './saved-page-store';

export const readerStoreSchema = `
DEFINE TABLE IF NOT EXISTS feed SCHEMALESS;
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE feed TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS feed_owner_url ON feed FIELDS owner, url UNIQUE;
DEFINE TABLE IF NOT EXISTS feed_item SCHEMALESS;
DEFINE FIELD IF NOT EXISTS publishedAt ON TABLE feed_item TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS feed_item_feed_url ON feed_item FIELDS feedId, url UNIQUE;
DEFINE INDEX IF NOT EXISTS feed_item_owner_item ON feed_item FIELDS owner, itemId;
DEFINE INDEX IF NOT EXISTS feed_item_owner_feed_item ON feed_item FIELDS owner, feedId, itemId;
DEFINE INDEX IF NOT EXISTS feed_item_owner_read_item ON feed_item FIELDS owner, read, itemId;
DEFINE TABLE IF NOT EXISTS saved_page SCHEMALESS;
DEFINE FIELD IF NOT EXISTS publishedAt ON TABLE saved_page TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS saved_page_owner_url ON saved_page FIELDS owner, url UNIQUE;
DEFINE INDEX IF NOT EXISTS saved_page_owner_page ON saved_page FIELDS owner, pageId;
DEFINE TABLE IF NOT EXISTS setting SCHEMALESS;
DEFINE INDEX IF NOT EXISTS setting_owner ON setting FIELDS owner UNIQUE;
`;

class ReaderStoreConcurrency extends Context.Service<
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

    return makeFeedRepository(db, lock);
  })
);

export const ReaderStoreLive = Layer.mergeAll(
  FeedItemRepositoryLive,
  SavedPageRepositoryLive,
  FeedRepositoryLive
).pipe(Layer.provide(ReaderStoreConcurrencyLive));
