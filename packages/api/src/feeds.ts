import { Feed, FeedId, FeedItem, FeedItemId, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  created,
  extractionErrors,
  limit,
  ok,
  subscribePayload,
  unreadOnly,
  urlPayload,
} from './common';
import {
  FeedAlreadyExists,
  FeedItemNotFound,
  FeedItemRepositoryError,
  FeedParserError,
  FeedRepositoryError,
  FeedUrlInvalid,
  FetchFeedError,
  FolderNotFound,
  FolderRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const listResponse = Schema.Struct({ items: Schema.Array(Feed) });

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

const previewResponse = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  titles: Schema.Array(Schema.String),
});

const unreadCounts = Schema.Struct({
  feeds: Schema.Array(Schema.Struct({ feedId: FeedId, count: Schema.Int })),
});

export const feedEndpoints = [
  HttpApiEndpoint.get('feeds', '/api/library/feeds', {
    success: listResponse,
    error: FeedRepositoryError,
  }),
  HttpApiEndpoint.post('preview', '/api/library/feeds/preview', {
    payload: urlPayload,
    success: Schema.Struct({ preview: previewResponse }),
    error: [FeedUrlInvalid, FetchFeedError, FeedParserError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('subscribe', '/api/library/feeds', {
    payload: subscribePayload,
    success: created(Schema.Struct({ item: Feed })),
    error: [
      FeedUrlInvalid,
      FeedAlreadyExists,
      FeedRepositoryError,
      FolderNotFound,
      FolderRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('unsubscribe', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId }),
    success: ok,
    error: FeedRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('moveFeed', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId, folderId: Schema.NullOr(FolderId) }),
    success: ok,
    error: [FolderNotFound, FeedRepositoryError, FolderRepositoryError],
  }).middleware(OriginCheck),
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
