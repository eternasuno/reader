import { FETCH_TIMEOUT_MS } from './deadline';
import {
  decodeCount,
  decodeItems,
  decodePage,
  decodeWith,
  isFeedItem,
  isFolder,
  isNullable,
  isSavedPage,
  isSession,
} from './decoders';
import { item, pageParams, request, requestNoContent } from './request';
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
      params: pageParams(params),
    }),
  unreadCount: async (options?: RequestCallOptions): Promise<number> => {
    const count = await request(
      '/api/saved-pages/unread-count',
      decodeCount,
      options
    );

    return count;
  },
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
  list: async (options?: RequestCallOptions): Promise<Array<Folder>> => {
    const items = await request('/api/folders', decodeItems(isFolder), options);

    return items;
  },
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
        params: pageParams(params),
      }
    ),
};
