import { FeedItemId, SavedPage, SavedPageId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  created,
  extractionErrors,
  limit,
  ok,
  unreadOnly,
  urlPayload,
} from './common';
import {
  FeedItemNotFound,
  FeedItemRepositoryError,
  InvalidPageUrl,
  SavedPageAlreadyExists,
  SavedPageRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const ListResponse = Schema.Struct({
  items: Schema.Array(SavedPage),
  cursor: Schema.NullOr(SavedPageId),
});

const ItemResponse = Schema.Struct({ item: SavedPage });

const NullableItemResponse = Schema.Struct({
  item: Schema.NullOr(SavedPage),
});

const listQuery = {
  unreadOnly,
  limit,
  cursor: Schema.optionalKey(SavedPageId),
};

const savedPageKey = { id: SavedPageId };

export const savedPageEndpoints = [
  HttpApiEndpoint.get('savedPages', '/api/library/saved-pages', {
    query: listQuery,
    success: ListResponse,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.get('savedPage', '/api/library/saved-pages/item', {
    query: savedPageKey,
    success: NullableItemResponse,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.get('savedPageByUrl', '/api/library/saved-pages/by-url', {
    query: { url: Schema.String },
    success: NullableItemResponse,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.post('addSavedPage', '/api/library/saved-pages', {
    payload: urlPayload,
    success: created(ItemResponse),
    error: [
      InvalidPageUrl,
      SavedPageAlreadyExists,
      ...extractionErrors,
      SavedPageRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.post(
    'saveFeedItem',
    '/api/library/saved-pages/from-feed-item',
    {
      payload: Schema.Struct({ id: FeedItemId }),
      success: created(ItemResponse),
      error: [
        FeedItemNotFound,
        SavedPageAlreadyExists,
        ...extractionErrors,
        FeedItemRepositoryError,
        SavedPageRepositoryError,
      ],
    }
  ).middleware(OriginCheck),
  HttpApiEndpoint.patch('markSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct({ ...savedPageKey, read: Schema.Boolean }),
    success: ok,
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markSavedPages', '/api/library/saved-pages/mark-read', {
    payload: Schema.Struct({ ids: Schema.Array(SavedPageId) }),
    success: ok,
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post(
    'markAllSavedPages',
    '/api/library/saved-pages/mark-all-read',
    {
      payload: Schema.Struct({}),
      success: ok,
      error: SavedPageRepositoryError,
    }
  ).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct(savedPageKey),
    success: ok,
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.get('savedPageUnread', '/api/library/saved-pages/unread', {
    success: Schema.Struct({ count: Schema.Int }),
    error: SavedPageRepositoryError,
  }),
] as const;
