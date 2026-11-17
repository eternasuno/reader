import type { Layer } from 'effect';
import type { FeedItemRepository } from '../../../src/port/feed-item-repository';
import type { FeedRepository } from '../../../src/port/feed-repository';
import type { FolderRepository } from '../../../src/port/folder-repository';
import type { SavedPageRepository } from '../../../src/port/saved-page-repository';
import type { SettingRepository } from '../../../src/port/setting-repository';

/**
 * The three feed-side ports share one state, so a suite over any of them takes
 * all three (CM-PORT-2): cascades and folder membership need them together.
 */
export type FeedStorePorts =
  | FeedRepository
  | FeedItemRepository
  | FolderRepository;

/**
 * Builds the implementation under test: the memory doubles or the SQLite
 * adapters. A suite calls it once per test, so every test starts empty and
 * never sees another test's rows.
 */
export type FeedStoreFactory = () => Layer.Layer<FeedStorePorts, never>;

export type SavedPageStoreFactory = () => Layer.Layer<
  SavedPageRepository,
  never
>;

export type SettingStoreFactory = () => Layer.Layer<SettingRepository, never>;
