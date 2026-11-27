import { FETCH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './deadline';
import {
  decodeFeedItemOrder,
  decodeFeedItems,
  decodeField,
  decodeSingleFeedOrder,
  decodeUnreadCounts,
  decodeWith,
  isArrayOf,
  isExtractedFeedItem,
  isFeed,
  isFeedItem,
  isFeedPreview,
  isNullable,
  isOPMLImportResult,
} from './decoders';
import { item, itemsByIds, request, requestNoContent } from './request';
import type {
  Feed,
  FeedCreateInput,
  FeedItem,
  FeedPreview,
  OPMLImportResult,
  OrderParams,
  RequestCallOptions,
  SortOrder,
  UnreadCounts,
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
  unreadCounts: (options?: RequestCallOptions): Promise<UnreadCounts> =>
    request('/api/feeds/unread-counts', decodeUnreadCounts, options),
  markAllRead: (
    id: string,
    before: string,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent(`/api/feeds/${encodeURIComponent(id)}/read-all`, {
      ...options,
      method: 'POST',
      body: { before },
    }),
  itemsOrder: (
    id: string,
    params: OrderParams & { order?: SortOrder } = {},
    options?: RequestCallOptions
  ) =>
    request(
      `/api/feeds/${encodeURIComponent(id)}/items/order`,
      decodeSingleFeedOrder,
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
  order: (params: OrderParams = {}, options?: RequestCallOptions) =>
    request('/api/feed-items/order', decodeFeedItemOrder, {
      ...options,
      params,
    }),
  byIds: (ids: ReadonlyArray<string>, options?: RequestCallOptions) =>
    itemsByIds('/api/feed-items', decodeFeedItems, ids, options),
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
  markAllRead: (before: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/feed-items/read-all', {
      ...options,
      method: 'POST',
      body: { before },
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
