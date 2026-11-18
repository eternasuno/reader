import { Layer } from 'effect';
import { FeedHandlersLive } from './feed';
import { FeedItemHandlersLive } from './feed-item';
import { FolderHandlersLive } from './folder';
import { KindleHandlersLive } from './kindle';
import { SavedPageHandlersLive } from './saved-page';
import { SettingHandlersLive } from './setting';

/** Every contract group's handler layer, implemented once. */
export const ReaderHandlersLive = Layer.mergeAll(
  SavedPageHandlersLive,
  FeedHandlersLive,
  FeedItemHandlersLive,
  FolderHandlersLive,
  SettingHandlersLive,
  KindleHandlersLive
);
