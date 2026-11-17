import { feedRepositoryContract } from '@reader/business/testing';
import { feedStoreLayer } from './support';

feedRepositoryContract(feedStoreLayer);
