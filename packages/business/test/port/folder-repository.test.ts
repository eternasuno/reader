import { folderRepositoryContract } from './folder-repository-contract';
import { MemoryFeedStoreLive } from './memory-feed-store';

folderRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);
