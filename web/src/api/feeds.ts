import { FETCH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './deadline';
import {
  decodeField,
  decodePage,
  decodeWith,
  isArrayOf,
  isExtractedFeedItem,
  isFeed,
  isFeedItem,
  isFeedPreview,
  isFeedUnreadCount,
  isNullable,
  isOPMLImportResult,
} from './decoders';
import { item, request, requestNoContent } from './request';
import type {
  Feed,
  FeedCreateInput,
  FeedItem,
  FeedPreview,
  FeedUnreadCount,
  ListParams,
  OPMLImportResult,
  Page,
  RequestCallOptions,
  SortOrder,
} from './types';

export const feedsApi = {
  exportOpmlUrl: '/api/opml',
  list: (options?: RequestCallOptions): Promise<Array<Feed>> =>
    request('/api/feeds', decodeField('items', isArrayOf(isFeed)), options),
  preview: (url: string, options?: RequestCallOptions): Promise<FeedPreview> =>
    request('/api/feeds/preview', decodeField('preview', isFeedPreview), {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...options,
      method: 'POST',
      body: { url },
    }),
  create: (
    input: FeedCreateInput,
    options?: RequestCallOptions
  ): Promise<Feed> =>
    item('/api/feeds', isFeed, { ...options, method: 'POST', body: input }),
  remove: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}`, {
      ...options,
      method: 'DELETE',
    }),
  refresh: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(
      `/api/feeds/${encodeURIComponent(id)}/refresh`,
      {
        ...options,
        method: 'POST',
      },
      202
    ),
  setReaderMode: (
    id: string,
    readerMode: Feed['readerMode'],
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}/reader-mode`, {
      ...options,
      method: 'PUT',
      body: { readerMode },
    }),
  setOrder: (
    id: string,
    order: SortOrder,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}/order`, {
      ...options,
      method: 'PUT',
      body: { order },
    }),
  moveToFolder: (
    id: string,
    folderId: string | null,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}`, {
      ...options,
      method: 'PATCH',
      body: { folderId },
    }),
  unreadCounts: (
    options?: RequestCallOptions
  ): Promise<Array<FeedUnreadCount>> =>
    request(
      '/api/feeds/unread-counts',
      decodeField('items', isArrayOf(isFeedUnreadCount)),
      options
    ),
  markAllRead: (id: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}/read-all`, {
      ...options,
      method: 'POST',
    }),
  listItems: (
    id: string,
    params: ListParams = {},
    options?: RequestCallOptions
  ): Promise<Page<FeedItem>> =>
    request(
      `/api/feeds/${encodeURIComponent(id)}/items`,
      decodePage(isFeedItem),
      {
        ...options,
        params,
      }
    ),
  importOpml: (
    file: File,
    options?: RequestCallOptions
  ): Promise<OPMLImportResult> => {
    const form = new FormData();
    form.append('file', file);

    return request('/api/opml', decodeWith(isOPMLImportResult), {
      timeoutMs: UPLOAD_TIMEOUT_MS,
      ...options,
      method: 'POST',
      rawBody: form,
    });
  },
};

export const feedItemsApi = {
  listAll: (
    params: ListParams = {},
    options?: RequestCallOptions
  ): Promise<Page<FeedItem>> =>
    request('/api/feed-items', decodePage(isFeedItem), {
      ...options,
      params,
    }),
  getById: (
    id: string,
    options?: RequestCallOptions
  ): Promise<FeedItem | null> =>
    item(
      `/api/feed-items/${encodeURIComponent(id)}`,
      isNullable(isFeedItem),
      options
    ),
  setRead: (
    id: string,
    read: boolean,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/feed-items/${encodeURIComponent(id)}`, {
      ...options,
      method: 'PATCH',
      body: { read },
    }),
  markIdsRead: (
    ids: ReadonlyArray<string>,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/feed-items/read', {
      ...options,
      method: 'POST',
      body: { ids },
    }),
  markAllRead: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/feed-items/read-all', {
      ...options,
      method: 'POST',
    }),
  extract: (id: string, options?: RequestCallOptions): Promise<FeedItem> =>
    item(
      `/api/feed-items/${encodeURIComponent(id)}/extract`,
      isExtractedFeedItem,
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        ...options,
        method: 'POST',
      }
    ),
};
