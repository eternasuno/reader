import { FETCH_TIMEOUT_MS } from './deadline';
import {
  decodeFeedItemOrder,
  decodeField,
  decodeSavedPageOrder,
  decodeSavedPages,
  decodeSavedPageUnreadCount,
  decodeWith,
  isArrayOf,
  isFolder,
  isNullable,
  isSavedPage,
  isSession,
} from './decoders';
import { item, itemsByIds, request, requestNoContent } from './request';
import type {
  Folder,
  OrderParams,
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
  order: (params: OrderParams = {}, options?: RequestCallOptions) =>
    request('/api/saved-pages/order', decodeSavedPageOrder, {
      ...options,
      params,
    }),
  byIds: (ids: ReadonlyArray<string>, options?: RequestCallOptions) =>
    itemsByIds('/api/saved-pages', decodeSavedPages, ids, options),
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
  itemsOrder: (
    id: string,
    params: OrderParams = {},
    options?: RequestCallOptions
  ) =>
    request(
      `/api/folders/${encodeURIComponent(id)}/items/order`,
      decodeFeedItemOrder,
      {
        ...options,
        params,
      }
    ),
};
