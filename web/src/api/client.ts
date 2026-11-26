import { FETCH_TIMEOUT_MS } from './deadline';
import {
  decodeField,
  decodeSavedPageUnreadCount,
  decodeWith,
  isArrayOf,
  isFeedItem,
  isFolder,
  isNullable,
  isSavedPage,
  isSession,
} from './decoders';
import { item, listPage, request, requestNoContent } from './request';
import type {
  FeedItem,
  Folder,
  ListParams,
  Page,
  RequestCallOptions,
  SavedPage,
  SavedPageUnreadCount,
  Session,
} from './types';

export { onUnauthorized } from './request';

export const authApi = {
  getSession: (options?: RequestCallOptions): Promise<Session> =>
    request('/api/auth/session', decodeWith(isSession), options),
  login: (password: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/auth/login', {
      ...options,
      method: 'POST',
      body: { password },
      login: true,
    }),
  logout: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/auth/logout', { ...options, method: 'POST' }),
};

export const savedPagesApi = {
  list: (
    params: ListParams = {},
    options?: RequestCallOptions
  ): Promise<Page<SavedPage>> =>
    listPage('/api/saved-pages', isSavedPage, params, options),
  unreadCount: (options?: RequestCallOptions): Promise<SavedPageUnreadCount> =>
    request(
      '/api/saved-pages/unread-count',
      decodeSavedPageUnreadCount,
      options
    ),
  getById: (
    id: string,
    options?: RequestCallOptions
  ): Promise<SavedPage | null> =>
    item(
      `/api/saved-pages/${encodeURIComponent(id)}`,
      isNullable(isSavedPage),
      options
    ),
  create: (url: string, options?: RequestCallOptions): Promise<SavedPage> =>
    item('/api/saved-pages', isSavedPage, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...options,
      method: 'POST',
      body: { url },
    }),
  saveFeedItem: (
    id: string,
    options?: RequestCallOptions
  ): Promise<SavedPage> =>
    item(`/api/feed-items/${encodeURIComponent(id)}/save`, isSavedPage, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...options,
      method: 'POST',
    }),
  setRead: (
    id: string,
    read: boolean,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/saved-pages/${encodeURIComponent(id)}`, {
      ...options,
      method: 'PATCH',
      body: { read },
    }),
  markIdsRead: (
    ids: ReadonlyArray<string>,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/saved-pages/read', {
      ...options,
      method: 'POST',
      body: { ids },
    }),
  markAllRead: (before: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/saved-pages/read-all', {
      ...options,
      method: 'POST',
      body: { before },
    }),
  remove: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(`/api/saved-pages/${encodeURIComponent(id)}`, {
      ...options,
      method: 'DELETE',
    }),
};

export const foldersApi = {
  list: (options?: RequestCallOptions): Promise<Array<Folder>> =>
    request('/api/folders', decodeField('items', isArrayOf(isFolder)), options),
  create: (name: string, options?: RequestCallOptions): Promise<Folder> =>
    item('/api/folders', isFolder, {
      ...options,
      method: 'POST',
      body: { name },
    }),
  rename: (
    id: string,
    name: string,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/folders/${encodeURIComponent(id)}`, {
      ...options,
      method: 'PATCH',
      body: { name },
    }),
  remove: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(`/api/folders/${encodeURIComponent(id)}`, {
      ...options,
      method: 'DELETE',
    }),
  markAllRead: (
    id: string,
    before: string,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/folders/${encodeURIComponent(id)}/read-all`, {
      ...options,
      method: 'POST',
      body: { before },
    }),
  listItems: (
    id: string,
    params: ListParams = {},
    options?: RequestCallOptions
  ): Promise<Page<FeedItem>> =>
    listPage(
      `/api/folders/${encodeURIComponent(id)}/items`,
      isFeedItem,
      params,
      options
    ),
};
