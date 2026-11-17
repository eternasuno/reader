import type {
  FeedStoreLayer,
  SavedPageStoreLayer,
} from '@reader/business/testing';
import { Layer } from 'effect';
import {
  ReaderStoreLive,
  readerMigrationLayer,
  readerSqliteLayer,
  SavedPageRepositoryLive,
  SettingRepositoryLive,
} from '../../src';

export const readerDatabaseLayer = readerMigrationLayer.pipe(
  Layer.provideMerge(readerSqliteLayer(':memory:'))
);

export const feedStoreLayer: FeedStoreLayer = ReaderStoreLive.pipe(
  Layer.provide(readerDatabaseLayer)
);

export const readerStoreDatabaseLayer = ReaderStoreLive.pipe(
  Layer.provideMerge(readerDatabaseLayer)
);

export const savedPageStoreLayer: SavedPageStoreLayer =
  SavedPageRepositoryLive.pipe(Layer.provide(readerDatabaseLayer));

export const settingStoreLayer = SettingRepositoryLive.pipe(
  Layer.provide(readerDatabaseLayer)
);
