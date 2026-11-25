import { FETCH_TIMEOUT_MS } from './deadline';
import {
  decodeField,
  decodePage,
  decodeWith,
  isArrayOf,
  isFeedItem,
  isFiniteNumber,
  isFolder,
  isNullable,
  isSavedPage,
  isSession,
} from './decoders';
import { item, request, requestNoContent } from './request';
import type {
  FeedItem,
  Folder,
  ListParams,
  Page,
  RequestCallOptions,
  SavedPage,
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
    request('/api/saved-pages', decodePage(isSavedPage), {
      ...options,
      params,
    }),
  unreadCount: (options?: RequestCallOptions): Promise<number> =>
    request(
      '/api/saved-pages/unread-count',
      decodeField('count', isFiniteNumber),
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
  markAllRead: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/saved-pages/read-all', {
      ...options,
      method: 'POST',
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
  markAllRead: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(`/api/folders/${encodeURIComponent(id)}/read-all`, {
      ...options,
      method: 'POST',
    }),
  listItems: (
    id: string,
    params: ListParams = {},
    options?: RequestCallOptions
  ): Promise<Page<FeedItem>> =>
    request(
      `/api/folders/${encodeURIComponent(id)}/items`,
      decodePage(isFeedItem),
      {
        ...options,
        params,
      }
    ),
};
