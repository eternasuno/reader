import { FeedItemId, SavedPage, SavedPageId } from '@reader/business';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { created, extractionErrors, limitQuery, unreadQuery } from './common';
import {
  FeedItemNotFound,
  FeedItemRepositoryError,
  InvalidPageUrl,
  SavedPageAlreadyExists,
  SavedPageRepositoryError,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

const SavedPageItem = Schema.Struct({ item: SavedPage });

const SavedPageItemOrNone = Schema.Struct({
  item: Schema.NullOr(SavedPage),
});

const SavedPageList = Schema.Struct({
  items: Schema.Array(SavedPage),
  cursor: Schema.NullOr(SavedPageId),
});

const SavedPageUnreadCount = Schema.Struct({ count: Schema.Int });

/** `limit`, `unread` and the cursor id of the saved-page list (CM-PAGE). */
export const savedPageListQuery = Schema.Struct({
  limit: limitQuery,
  unread: unreadQuery,
  cursor: Schema.optional(SavedPageId),
});

const savedPageParams = { id: SavedPageId };

/**
 * Saved pages (`稍后阅读`), plus saving a feed item, which creates a saved page
 * (later.md API).
 */
export const SavedPageApi = HttpApiGroup.make('saved-page').add(
  HttpApiEndpoint.get('listSavedPages', '/saved-pages', {
    query: savedPageListQuery,
    success: SavedPageList,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.get('savedPageUnreadCount', '/saved-pages/unread-count', {
    success: SavedPageUnreadCount,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.get('lookupSavedPage', '/saved-pages/lookup', {
    query: { url: Schema.String },
    success: SavedPageItemOrNone,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.get('getSavedPage', '/saved-pages/:id', {
    params: savedPageParams,
    success: SavedPageItemOrNone,
    error: SavedPageRepositoryError,
  }),
  HttpApiEndpoint.post('addSavedPage', '/saved-pages', {
    payload: Schema.Struct({ url: Schema.String }),
    success: created(SavedPageItem),
    error: [
      InvalidPageUrl,
      SavedPageAlreadyExists,
      ...extractionErrors,
      SettingRepositoryError,
      SavedPageRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('saveFeedItem', '/feed-items/:id/save', {
    params: { id: FeedItemId },
    success: created(SavedPageItem),
    error: [
      FeedItemNotFound,
      SavedPageAlreadyExists,
      ...extractionErrors,
      SettingRepositoryError,
      FeedItemRepositoryError,
      SavedPageRepositoryError,
    ],
  }).middleware(OriginCheck),
  HttpApiEndpoint.patch('markSavedPage', '/saved-pages/:id', {
    params: savedPageParams,
    payload: Schema.Struct({ read: Schema.Boolean }),
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markSavedPages', '/saved-pages/read', {
    payload: Schema.Struct({ ids: Schema.Array(SavedPageId) }),
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.post('markAllSavedPages', '/saved-pages/read-all', {
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck),
  HttpApiEndpoint.delete('removeSavedPage', '/saved-pages/:id', {
    params: savedPageParams,
    error: SavedPageRepositoryError,
  }).middleware(OriginCheck)
);
