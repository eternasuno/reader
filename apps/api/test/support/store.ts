import { randomUUID } from 'node:crypto';
import {
  type FeedItemRepository,
  type FeedRepository,
  type FolderRepository,
  NormalizedUrl,
  OwnerId,
  type SavedPageRepository,
  type SettingRepository,
} from '@reader/business';
import type {
  FeedStoreLayer,
  SavedPageStoreLayer,
} from '@reader/business/testing';
import { Effect, Layer, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { createSurreal, Database } from '../../src/db';
import {
  FeedItemRepositoryLive,
  FeedRepositoryLive,
  FolderRepositoryLive,
  ReaderStoreConcurrencyLive,
  SavedPageRepositoryLive,
  SettingRepositoryLive,
} from '../../src/store';
import { readerStoreSchema } from '../../src/store/schema';

const databaseLayer = (): Layer.Layer<Database> =>
  Layer.effect(
    Database,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const db = await createSurreal({
          endpoint: 'mem://',
          namespace: `reader-store-${randomUUID()}`,
          database: 'test',
        });
        await db.query(readerStoreSchema);

        return db;
      }),
      (db) => Effect.promise(() => db.close())
    )
  );

const readerDatabase = databaseLayer();

const readerDependencies = Layer.merge(
  readerDatabase,
  ReaderStoreConcurrencyLive
);

const feedRepositoryLayer = FeedRepositoryLive.pipe(
  Layer.provide(readerDependencies)
);

const feedItemRepositoryLayer = FeedItemRepositoryLive.pipe(
  Layer.provide(readerDependencies)
);

const savedPageRepositoryLayer = SavedPageRepositoryLive.pipe(
  Layer.provide(readerDependencies)
);

const folderRepositoryLayer = FolderRepositoryLive.pipe(
  Layer.provide(readerDependencies)
);

export const feedStoreLayer: FeedStoreLayer = Layer.mergeAll(
  feedRepositoryLayer,
  feedItemRepositoryLayer,
  folderRepositoryLayer
);

export const savedPageStoreLayer: SavedPageStoreLayer =
  savedPageRepositoryLayer;

const readerStoreLayer: Layer.Layer<
  FeedRepository | FeedItemRepository | FolderRepository | SavedPageRepository
> = Layer.mergeAll(
  feedRepositoryLayer,
  feedItemRepositoryLayer,
  folderRepositoryLayer,
  savedPageRepositoryLayer
);

export const readerStoreDatabaseLayer: Layer.Layer<
  | FeedRepository
  | FeedItemRepository
  | FolderRepository
  | SavedPageRepository
  | Database
> = Layer.merge(readerStoreLayer, readerDatabase);

const settingDatabase = databaseLayer();

export const settingStoreLayer: Layer.Layer<SettingRepository> =
  SettingRepositoryLive.pipe(Layer.provide(settingDatabase));

export const settingStoreDatabaseLayer: Layer.Layer<
  SettingRepository | Database
> = Layer.merge(settingStoreLayer, settingDatabase);

export const owner = Schema.decodeSync(OwnerId);

export const url = Schema.decodeSync(NormalizedUrl);

export const query = <A>(
  db: Surreal,
  sql: string,
  bindings: Record<string, unknown> = {}
) =>
  Effect.promise(async () => {
    const [rows] = await db.query<[A]>(sql, bindings);

    return rows;
  });
