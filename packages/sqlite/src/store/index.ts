import { Layer } from 'effect';
import { FeedRepositoryLive } from './feed';
import { FeedItemRepositoryLive } from './feed-item';
import { FolderRepositoryLive } from './folder';
import { SavedPageRepositoryLive } from './saved-page';
import { SettingRepositoryLive } from './setting';

export const ReaderStoreLive = Layer.mergeAll(
  FeedRepositoryLive,
  FeedItemRepositoryLive,
  FolderRepositoryLive,
  SavedPageRepositoryLive,
  SettingRepositoryLive
);
