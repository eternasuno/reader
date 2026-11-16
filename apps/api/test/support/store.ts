import { SqliteMigrator } from '@effect/sql-sqlite-node';
import type {
  FeedStoreLayer,
  SavedPageStoreLayer,
} from '@reader/business/testing';
import { Layer } from 'effect';
import {
  ReaderStoreLive,
  SavedPageRepositoryLive,
  SettingRepositoryLive,
} from '../../src/store';
import { readerSqliteLayer } from '../../src/store/client';
import { readerMigrations } from '../../src/store/schema';

export const readerDatabaseLayer = SqliteMigrator.layer({
  loader: readerMigrations,
}).pipe(Layer.provideMerge(readerSqliteLayer(':memory:')));

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
