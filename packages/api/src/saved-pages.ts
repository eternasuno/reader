import { FeedItemId, SavedPage, SavedPageId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint } from 'effect/http-api';
import {
  batchIds,
  created,
  extractionErrors,
  FeedItemNotFoundSchema,
  feedItemErrors,
  InvalidPageUrlSchema,
  limit,
  ok,
  SavedPageAlreadyExistsSchema,
  savedPageErrors,
  unreadOnly,
  urlPayload,
} from './common';

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
    error: savedPageErrors,
  }),
  HttpApiEndpoint.get('savedPage', '/api/library/saved-pages/item', {
    query: savedPageKey,
    success: NullableItemResponse,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.get('savedPageByUrl', '/api/library/saved-pages/by-url', {
    query: { url: Schema.String.check(Schema.isMaxLength(4096)) },
    success: NullableItemResponse,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post('addSavedPage', '/api/library/saved-pages', {
    payload: urlPayload,
    success: created(ItemResponse),
    error: [
      InvalidPageUrlSchema,
      SavedPageAlreadyExistsSchema,
      ...extractionErrors,
      ...savedPageErrors,
    ],
  }),
  HttpApiEndpoint.post(
    'saveFeedItem',
    '/api/library/saved-pages/from-feed-item',
    {
      payload: Schema.Struct({ id: FeedItemId }),
      success: created(ItemResponse),
      error: [
        FeedItemNotFoundSchema,
        SavedPageAlreadyExistsSchema,
        ...extractionErrors,
        ...feedItemErrors,
        ...savedPageErrors,
      ],
    }
  ),
  HttpApiEndpoint.patch('markSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct({ ...savedPageKey, read: Schema.Boolean }),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post('markSavedPages', '/api/library/saved-pages/mark-read', {
    payload: batchIds(SavedPageId),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.post(
    'markAllSavedPages',
    '/api/library/saved-pages/mark-all-read',
    {
      payload: Schema.Struct({}),
      success: ok,
      error: savedPageErrors,
    }
  ),
  HttpApiEndpoint.delete('removeSavedPage', '/api/library/saved-pages', {
    payload: Schema.Struct(savedPageKey),
    success: ok,
    error: savedPageErrors,
  }),
  HttpApiEndpoint.get('savedPageUnread', '/api/library/saved-pages/unread', {
    success: Schema.Struct({ count: Schema.Int }),
    error: savedPageErrors,
  }),
] as const;
