import { feedRepositoryContract } from '../support/contract/feed';
import { feedItemRepositoryContract } from '../support/contract/feed-item';
import { folderRepositoryContract } from '../support/contract/folder';
import { savedPageRepositoryContract } from '../support/contract/saved-page';
import { settingRepositoryContract } from '../support/contract/setting';
import { MemoryFeedStoreLive } from '../support/memory/feed-store';
import { MemorySavedPageRepositoryLive } from '../support/memory/saved-page';
import { MemorySettingRepositoryLive } from '../support/memory/setting';

feedRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);

folderRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);

feedItemRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);

savedPageRepositoryContract(
  'MemorySavedPageRepository',
  MemorySavedPageRepositoryLive
);

settingRepositoryContract(MemorySettingRepositoryLive);
