import { Schema } from 'effect';
import { OwnerId } from '../object-value/owner-id';
import { FeedSetting } from './feed';
import { FetcherSetting } from './fetcher';

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  feed: FeedSetting,
  fetcher: FetcherSetting,
});

export type Setting = typeof Setting.Type;
