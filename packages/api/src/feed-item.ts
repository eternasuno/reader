import { FeedId, FeedItem, FeedItemId, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import { extractionErrors, limit, ok, unreadOnly } from './common';
import { FeedItemNotFound, FeedItemRepositoryError } from './errors';
import { OriginCheck } from './middleware';

const pageQuery = {
  unreadOnly,
  limit,
  cursor: Schema.optionalKey(FeedItemId),
};

const feedItemPage = Schema.Struct({
  items: Schema.Array(FeedItem),
  cursor: Schema.NullOr(FeedItemId),
});

const itemQuery = { id: FeedItemId };

const unreadCounts = Schema.Struct({
  feeds: Schema.Array(Schema.Struct({ feedId: FeedId, count: Schema.Int })),
});

export const feedItemEndpoints = [
  HttpApiEndpoint.get('feedUnread', '/api/library/feeds/unread', {
    success: unreadCounts,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.post('markFeedsRead', '/api/library/feeds/mark-read', {
    payload: Schema.Struct({
      feedIds: Schema.Array(FeedId),
    }),
    success: ok,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markAllFeedItems', '/api/library/feeds/mark-all-read', {
    payload: Schema.Struct({}),
    success: ok,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.get('feedItems', '/api/library/feeds/items', {
    query: pageQuery,
    success: feedItemPage,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.get('feedItemsByFeed', '/api/library/feeds/items/by-feed', {
    query: { feedId: FeedId, ...pageQuery },
    success: feedItemPage,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.get(
    'feedItemsByFolder',
    '/api/library/feeds/items/by-folder',
    {
      query: { folderId: FolderId, ...pageQuery },
      success: feedItemPage,
      error: FeedItemRepositoryError,
    }
  ),
  HttpApiEndpoint.get('feedItem', '/api/library/feeds/items/item', {
    query: itemQuery,
    success: Schema.Struct({ item: Schema.NullOr(FeedItem) }),
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.post('extractFeedItem', '/api/library/feeds/items/extract', {
    payload: Schema.Struct({ id: FeedItemId }),
    success: Schema.Struct({ item: FeedItem }),
    error: [FeedItemNotFound, ...extractionErrors, FeedItemRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('markFeedItem', '/api/library/feeds/items', {
    payload: Schema.Struct({ id: FeedItemId, read: Schema.Boolean }),
    success: ok,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markFeedItems', '/api/library/feeds/items/mark-read', {
    payload: Schema.Struct({
      ids: Schema.Array(FeedItemId),
    }),
    success: ok,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
] as const;
