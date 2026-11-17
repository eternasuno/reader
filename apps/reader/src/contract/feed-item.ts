import { FeedItem, FeedItemId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { extractionErrors, limitQuery, unreadQuery } from './common';
import {
  FeedItemNotFound,
  FeedItemRepositoryError,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const FeedItemItem = Schema.Struct({ item: FeedItem });

const FeedItemItemOrNone = Schema.Struct({
  item: Schema.NullOr(FeedItem),
});

/** A page of feed items; also the shape of the single-feed and folder lists. */
export const feedItemListResponse = Schema.Struct({
  items: Schema.Array(FeedItem),
  cursor: Schema.NullOr(FeedItemId),
});

/**
 * `limit`, `unread` and the cursor id shared by the three feed-item lists
 * (CM-PAGE): `全部订阅`, one feed and one folder.
 */
export const feedItemListQuery = Schema.Struct({
  limit: limitQuery,
  unread: unreadQuery,
  cursor: Schema.optional(FeedItemId),
});

const feedItemParams = { id: FeedItemId };

/** Feed items, on their own and inside a feed (feeds.md API). */
export const FeedItemApi = HttpApiGroup.make('feed-item').add(
  HttpApiEndpoint.get('listFeedItems', '/feed-items', {
    query: feedItemListQuery,
    success: feedItemListResponse,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.get('getFeedItem', '/feed-items/:id', {
    params: feedItemParams,
    success: FeedItemItemOrNone,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.patch('markFeedItem', '/feed-items/:id', {
    params: feedItemParams,
    payload: Schema.Struct({ read: Schema.Boolean }),
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markFeedItems', '/feed-items/read', {
    payload: Schema.Struct({ ids: Schema.Array(FeedItemId) }),
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markAllFeedItems', '/feed-items/read-all', {
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('extractFeedItem', '/feed-items/:id/extract', {
    params: feedItemParams,
    success: FeedItemItem,
    error: [
      FeedItemNotFound,
      ...extractionErrors,
      SettingRepositoryError,
      FeedItemRepositoryError,
    ],
  }).middleware(OriginCheck)
);
