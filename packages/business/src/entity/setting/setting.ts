import { Schema } from 'effect';
import { OwnerId } from '../common/owner-id';
import { FetcherSetting } from './fetcher';
import { Retention } from './retention';

export const FeedSetting = Schema.Struct({
  retention: Retention,
});

export type FeedSetting = typeof FeedSetting.Type;

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  feed: FeedSetting,
  fetcher: FetcherSetting,
});

export type Setting = typeof Setting.Type;
