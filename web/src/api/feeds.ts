import { FETCH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './deadline';
import {
  decodeItems,
  decodePage,
  decodePreview,
  decodeWith,
  isExtractedFeedItem,
  isFeed,
  isFeedItem,
  isFeedUnreadCount,
  isNullable,
  isOPMLImportResult,
} from './decoders';
import { item, pageParams, request, requestNoContent } from './request';
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
  list: async (options?: RequestCallOptions): Promise<Array<Feed>> => {
    const items = await request('/api/feeds', decodeItems(isFeed), options);

    return items;
  },
  preview: async (
    url: string,
    options?: RequestCallOptions
  ): Promise<FeedPreview> => {
    const preview = await request('/api/feeds/preview', decodePreview, {
      timeoutMs: FETCH_TIMEOUT_MS,
      ...options,
      method: 'POST',
      body: { url },
    });

    return preview;
  },
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
  unreadCounts: async (
    options?: RequestCallOptions
  ): Promise<Array<FeedUnreadCount>> => {
    const items = await request(
      '/api/feeds/unread-counts',
      decodeItems(isFeedUnreadCount),
      options
    );

    return items;
  },
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
        params: pageParams(params),
      }
    ),
  importOpml: (
    fileOrXml: File | string,
    options?: RequestCallOptions
  ): Promise<OPMLImportResult> => {
    if (typeof fileOrXml === 'string') {
      return request('/api/opml', decodeWith(isOPMLImportResult), {
        timeoutMs: UPLOAD_TIMEOUT_MS,
        ...options,
        method: 'POST',
        rawBody: fileOrXml,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    const form = new FormData();
    form.append('file', fileOrXml);

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
      params: pageParams(params),
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
