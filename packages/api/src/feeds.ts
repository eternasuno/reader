import { Feed, FeedId, FeedItem, FeedItemId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  authErrors,
  created,
  extractionErrors,
  FeedAlreadyExistsSchema,
  FeedItemNotFoundSchema,
  FeedParserErrorSchema,
  FeedRepositoryErrorSchema,
  FeedUrlInvalidSchema,
  FetchFeedErrorSchema,
  feedItemErrors,
  limit,
  ok,
  subscribePayload,
  unreadOnly,
  urlPayload,
} from './common';

const listResponse = Schema.Struct({ items: Schema.Array(Feed) });

const listQuery = {
  feedId: Schema.optionalKey(FeedId),
  unreadOnly,
  limit,
  cursor: Schema.optionalKey(FeedItemId),
};

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
    error: [FeedRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.post('preview', '/api/library/feeds/preview', {
    payload: urlPayload,
    success: Schema.Struct({ preview: previewResponse }),
    error: [
      FeedUrlInvalidSchema,
      FetchFeedErrorSchema,
      FeedParserErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.post('subscribe', '/api/library/feeds', {
    payload: subscribePayload,
    success: created(Schema.Struct({ item: Feed })),
    error: [
      FeedUrlInvalidSchema,
      FeedAlreadyExistsSchema,
      FeedRepositoryErrorSchema,
      ...authErrors,
    ],
  }),
  HttpApiEndpoint.delete('unsubscribe', '/api/library/feeds', {
    payload: Schema.Struct({ id: FeedId }),
    success: ok,
    error: [FeedRepositoryErrorSchema, ...authErrors],
  }),
  HttpApiEndpoint.get('feedUnread', '/api/library/feeds/unread', {
    success: unreadCounts,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('markFeedsRead', '/api/library/feeds/mark-read', {
    payload: Schema.Struct({
      feedIds: Schema.Array(FeedId),
    }),
    success: ok,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('markAllFeedItems', '/api/library/feeds/mark-all-read', {
    payload: Schema.Struct({}),
    success: ok,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.get('feedItems', '/api/library/feeds/items', {
    query: listQuery,
    success: Schema.Struct({
      items: Schema.Array(FeedItem),
      cursor: Schema.NullOr(FeedItemId),
    }),
    error: feedItemErrors,
  }),
  HttpApiEndpoint.get('feedItem', '/api/library/feeds/items/item', {
    query: itemQuery,
    success: Schema.Struct({ item: Schema.NullOr(FeedItem) }),
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('extractFeedItem', '/api/library/feeds/items/extract', {
    payload: Schema.Struct({ id: FeedItemId }),
    success: Schema.Struct({ item: FeedItem }),
    error: [FeedItemNotFoundSchema, ...extractionErrors, ...feedItemErrors],
  }),
  HttpApiEndpoint.patch('markFeedItem', '/api/library/feeds/items', {
    payload: Schema.Struct({ id: FeedItemId, read: Schema.Boolean }),
    success: ok,
    error: feedItemErrors,
  }),
  HttpApiEndpoint.post('markFeedItems', '/api/library/feeds/items/mark-read', {
    payload: Schema.Struct({
      ids: Schema.Array(FeedItemId),
    }),
    success: ok,
    error: feedItemErrors,
  }),
] as const;
