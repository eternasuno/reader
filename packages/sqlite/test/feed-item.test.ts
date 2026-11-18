import { feedItemRepositoryContract } from '@reader/business/testing';
import { feedStoreLayer } from './support';

feedItemRepositoryContract(feedStoreLayer);
