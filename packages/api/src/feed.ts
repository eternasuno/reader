import { Feed, FeedId, FolderId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import { created, ok, subscribePayload, urlPayload } from './common';
import {
  FeedAlreadyExists,
  FeedParserError,
  FeedRepositoryError,
  FeedUrlInvalid,
  FetchFeedError,
  FolderNotFound,
  FolderRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const listResponse = Schema.Struct({ items: Schema.Array(Feed) });

const previewResponse = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  titles: Schema.Array(Schema.String),
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
] as const;
