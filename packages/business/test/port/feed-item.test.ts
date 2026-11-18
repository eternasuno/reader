import { feedItemRepositoryContract } from '../support/contract/feed-item';
import { memoryFeedStoreLayer } from '../support/memory/feed-store';

feedItemRepositoryContract(memoryFeedStoreLayer);
