import { feedRepositoryContract } from '../support/contract/feed';
import { memoryFeedStoreLayer } from '../support/memory/feed-store';

feedRepositoryContract(memoryFeedStoreLayer);
