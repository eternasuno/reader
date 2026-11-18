import { folderRepositoryContract } from '../support/contract/folder';
import { memoryFeedStoreLayer } from '../support/memory/feed-store';

folderRepositoryContract(memoryFeedStoreLayer);
