import type {
  FeedStoreFactory,
  SavedPageStoreFactory,
  SettingStoreFactory,
} from '@reader/business/testing';
import { Layer } from 'effect';
import {
  FeedItemRepositoryLive,
  FeedRepositoryLive,
  FolderRepositoryLive,
  readerClientLayer,
  readerMigrationLayer,
  SavedPageRepositoryLive,
  SettingRepositoryLive,
} from '../../src';

/**
 * A fresh in-memory reader database with migration `0001_reader` applied. The
 * Layer is lazy, so every build opens a new connection: no test sees another
 * test's rows.
 */
export const memoryDatabaseLayer = Layer.orDie(
  readerMigrationLayer.pipe(Layer.provideMerge(readerClientLayer(':memory:')))
);

const feedRepositories = Layer.mergeAll(
  FeedRepositoryLive,
  FeedItemRepositoryLive,
  FolderRepositoryLive
);

const readerRepositories = Layer.mergeAll(
  feedRepositories,
  SavedPageRepositoryLive,
  SettingRepositoryLive
);

export const feedStoreLayer: FeedStoreFactory = () =>
  feedRepositories.pipe(Layer.provide(memoryDatabaseLayer));

export const savedPageStoreLayer: SavedPageStoreFactory = () =>
  SavedPageRepositoryLive.pipe(Layer.provide(memoryDatabaseLayer));

export const settingStoreLayer: SettingStoreFactory = () =>
  SettingRepositoryLive.pipe(Layer.provide(memoryDatabaseLayer));

/** Every repository over one fresh database, with the connection exposed. */
export const readerStoreDatabaseLayer = readerRepositories.pipe(
  Layer.provideMerge(memoryDatabaseLayer)
);
