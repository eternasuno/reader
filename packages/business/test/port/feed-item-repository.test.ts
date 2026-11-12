import { feedItemRepositoryContract } from './feed-item-repository-contract';
import { MemoryFeedStoreLive } from './memory-feed-store';

feedItemRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);
