import { feedRepositoryContract } from './feed-repository-contract';
import { MemoryFeedStoreLive } from './memory-feed-store';

feedRepositoryContract('MemoryFeedStore', MemoryFeedStoreLive);
