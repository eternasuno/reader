import {
  ArticleTitle,
  Feed,
  FeedId,
  FeedOrder,
  FeedReaderMode,
  FeedTitle,
  FolderId,
  NormalizedUrl,
  OptionFromOptionalNonEmpty,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { created } from './common';
import {
  FeedAlreadyExists,
  FeedItemRepositoryError,
  FeedParserError,
  FeedRepositoryError,
  FeedUrlInvalid,
  FetchFeedError,
  FolderNotFound,
  FolderRepositoryError,
} from './errors';
import { feedItemListQuery, feedItemListResponse } from './feed-item';
import { OriginCheck } from './middleware';

const FeedResponse = Schema.Struct({ item: Feed });

const FeedList = Schema.Struct({ items: Schema.Array(Feed) });

const FeedPreview = Schema.Struct({
  url: NormalizedUrl,
  title: FeedTitle,
  description: OptionFromOptionalNonEmpty(Schema.String),
  titles: Schema.Array(ArticleTitle),
});

const FeedPreviewItem = Schema.Struct({ preview: FeedPreview });

const FeedUnreadCount = Schema.Struct({
  feedId: FeedId,
  count: Schema.Int,
});

const FeedUnreadCounts = Schema.Struct({
  items: Schema.Array(FeedUnreadCount),
});

const feedParams = { id: FeedId };

/**
 * The single-feed list also takes the feed's order, `newest` when absent
 * (FD-PREF-3); any other value is a structural failure.
 */
const feedItemsOfFeedQuery = Schema.Struct({
  ...feedItemListQuery.fields,
  order: FeedOrder.pipe(
    Schema.withDecodingDefaultType(Effect.succeed('newest' as const))
  ),
});

/**
 * Feeds: subscribing, the feed list and unread counts, a feed's preferences,
 * marking a feed read, the single-feed list, and moving a feed between folders
 * (feeds.md and folders.md API).
 */
export const FeedApi = HttpApiGroup.make('feed').add(
  HttpApiEndpoint.get('listFeeds', '/feeds', {
    success: FeedList,
    error: FeedRepositoryError,
  }),
  HttpApiEndpoint.post('previewFeed', '/feeds/preview', {
    payload: Schema.Struct({ url: Schema.String }),
    success: FeedPreviewItem,
    error: [FeedUrlInvalid, FetchFeedError, FeedParserError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('subscribeFeed', '/feeds', {
    payload: Schema.Struct({
      url: Schema.String,
      title: Schema.optional(Schema.String),
      folderId: Schema.optional(FolderId),
    }),
    success: created(FeedResponse),
    error: [
      FeedUrlInvalid,
      FolderNotFound,
      FeedAlreadyExists,
      FolderRepositoryError,
      FeedRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('unsubscribeFeed', '/feeds/:id', {
    params: feedParams,
    error: FeedRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('moveFeed', '/feeds/:id', {
    params: feedParams,
    payload: Schema.Struct({ folderId: Schema.NullOr(FolderId) }),
    error: [FolderNotFound, FeedRepositoryError, FolderRepositoryError],
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('setFeedReaderMode', '/feeds/:id/reader-mode', {
    params: feedParams,
    payload: Schema.Struct({ readerMode: FeedReaderMode }),
    error: FeedRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.put('setFeedOrder', '/feeds/:id/order', {
    params: feedParams,
    payload: Schema.Struct({ order: FeedOrder }),
    error: FeedRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.get('feedUnreadCounts', '/feeds/unread-counts', {
    success: FeedUnreadCounts,
    error: FeedItemRepositoryError,
  }),
  HttpApiEndpoint.post('markFeedRead', '/feeds/:id/read-all', {
    params: feedParams,
    error: FeedItemRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.get('listFeedItemsOfFeed', '/feeds/:id/items', {
    params: feedParams,
    query: feedItemsOfFeedQuery,
    success: feedItemListResponse,
    error: FeedItemRepositoryError,
  })
);
