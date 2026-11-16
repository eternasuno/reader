import {
  FeedItemRepository,
  FeedRepository,
  FolderRepository,
  SavedPageRepository,
  SettingRepository,
} from '@reader/business';
import { Layer } from 'effect';
import { makeFeedRepository } from './feed';
import { makeFeedItemRepository } from './feed-item';
import { makeFolderRepository } from './folder';
import { makeSavedPageRepository } from './saved-page';
import { makeSettingRepository } from './setting';

export const FeedRepositoryLive = Layer.effect(
  FeedRepository,
  makeFeedRepository
);

export const FeedItemRepositoryLive = Layer.effect(
  FeedItemRepository,
  makeFeedItemRepository
);

export const FolderRepositoryLive = Layer.effect(
  FolderRepository,
  makeFolderRepository
);

export const SavedPageRepositoryLive = Layer.effect(
  SavedPageRepository,
  makeSavedPageRepository
);

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  makeSettingRepository
);

export const ReaderStoreLive = Layer.mergeAll(
  FeedRepositoryLive,
  FeedItemRepositoryLive,
  FolderRepositoryLive,
  SavedPageRepositoryLive,
  SettingRepositoryLive
);
