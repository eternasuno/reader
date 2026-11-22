import { feedItemParams, item, pageParams, request } from './request';
import type {
  ExtractorProvider,
  Feed,
  FeedCreateInput,
  FeedItem,
  FeedItemListParams,
  FeedPreview,
  FeedUnreadCount,
  Folder,
  KindleSendRecord,
  KindleSends,
  KindleSettings,
  ListParams,
  OPMLImportResult,
  Page,
  SavedPage,
  Session,
  Settings,
  SmtpSettingsInput,
  SortOrder,
} from './types';

export { onUnauthorized } from './request';

export const authApi = {
  getSession: (): Promise<Session> => request<Session>('/api/auth/session'),
  login: (password: string): Promise<void> =>
    request<void>('/api/auth/login', {
      method: 'POST',
      body: { password },
      login: true,
    }),
  logout: (): Promise<void> =>
    request<void>('/api/auth/logout', { method: 'POST' }),
};

export const savedPagesApi = {
  list: (params: ListParams = {}): Promise<Page<SavedPage>> =>
    request<Page<SavedPage>>('/api/saved-pages', {
      params: pageParams(params),
    }),
  unreadCount: (): Promise<number> =>
    request<{ count: number }>('/api/saved-pages/unread-count').then(
      (response) => response.count
    ),
  lookup: (url: string): Promise<SavedPage | null> =>
    request<{ item: SavedPage | null }>('/api/saved-pages/lookup', {
      params: { url },
    }).then((response) => response.item),
  getById: (id: string): Promise<SavedPage | null> =>
    item<SavedPage | null>(`/api/saved-pages/${encodeURIComponent(id)}`),
  create: (url: string): Promise<SavedPage> =>
    item<SavedPage>('/api/saved-pages', { method: 'POST', body: { url } }),
  saveFeedItem: (id: string): Promise<SavedPage> =>
    item<SavedPage>(`/api/feed-items/${encodeURIComponent(id)}/save`, {
      method: 'POST',
    }),
  setRead: (id: string, read: boolean): Promise<void> =>
    request<void>(`/api/saved-pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { read },
    }),
  markIdsRead: (ids: ReadonlyArray<string>): Promise<void> =>
    request<void>('/api/saved-pages/read', { method: 'POST', body: { ids } }),
  markAllRead: (): Promise<void> =>
    request<void>('/api/saved-pages/read-all', { method: 'POST' }),
  remove: (id: string): Promise<void> =>
    request<void>(`/api/saved-pages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

export const feedsApi = {
  exportOpmlUrl: '/api/opml',
  list: (): Promise<Array<Feed>> =>
    request<{ items: Array<Feed> }>('/api/feeds').then(
      (response) => response.items
    ),
  preview: (url: string): Promise<FeedPreview> =>
    request<{ preview: FeedPreview }>('/api/feeds/preview', {
      method: 'POST',
      body: { url },
    }).then((response) => response.preview),
  create: (input: FeedCreateInput): Promise<Feed> =>
    item<Feed>('/api/feeds', { method: 'POST', body: input }),
  remove: (id: string): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refresh: (id: string): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
    }),
  setReaderMode: (id: string, readerMode: Feed['readerMode']): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}/reader-mode`, {
      method: 'PUT',
      body: { readerMode },
    }),
  setOrder: (id: string, order: SortOrder): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}/order`, {
      method: 'PUT',
      body: { order },
    }),
  moveToFolder: (id: string, folderId: string | null): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { folderId },
    }),
  unreadCounts: (): Promise<Array<FeedUnreadCount>> =>
    request<{ items: Array<FeedUnreadCount> }>('/api/feeds/unread-counts').then(
      (response) => response.items
    ),
  markAllRead: (id: string): Promise<void> =>
    request<void>(`/api/feeds/${encodeURIComponent(id)}/read-all`, {
      method: 'POST',
    }),
  listItems: (
    id: string,
    params: FeedItemListParams = {}
  ): Promise<Page<FeedItem>> =>
    request<Page<FeedItem>>(`/api/feeds/${encodeURIComponent(id)}/items`, {
      params: feedItemParams(params),
    }),
  importOpml: (fileOrXml: File | string): Promise<OPMLImportResult> => {
    if (typeof fileOrXml === 'string') {
      return request<OPMLImportResult>('/api/opml', {
        method: 'POST',
        rawBody: fileOrXml,
        headers: { 'Content-Type': 'application/xml' },
      });
    }

    const form = new FormData();
    form.append('file', fileOrXml);

    return request<OPMLImportResult>('/api/opml', {
      method: 'POST',
      rawBody: form,
    });
  },
};

export const feedItemsApi = {
  listAll: (params: ListParams = {}): Promise<Page<FeedItem>> =>
    request<Page<FeedItem>>('/api/feed-items', { params: pageParams(params) }),
  getById: (id: string): Promise<FeedItem | null> =>
    item<FeedItem | null>(`/api/feed-items/${encodeURIComponent(id)}`),
  setRead: (id: string, read: boolean): Promise<void> =>
    request<void>(`/api/feed-items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { read },
    }),
  markIdsRead: (ids: ReadonlyArray<string>): Promise<void> =>
    request<void>('/api/feed-items/read', { method: 'POST', body: { ids } }),
  markAllRead: (): Promise<void> =>
    request<void>('/api/feed-items/read-all', { method: 'POST' }),
  extract: (id: string): Promise<FeedItem> =>
    item<FeedItem>(`/api/feed-items/${encodeURIComponent(id)}/extract`, {
      method: 'POST',
    }),
};

export const foldersApi = {
  list: (): Promise<Array<Folder>> =>
    request<{ items: Array<Folder> }>('/api/folders').then(
      (response) => response.items
    ),
  create: (name: string): Promise<Folder> =>
    item<Folder>('/api/folders', { method: 'POST', body: { name } }),
  rename: (id: string, name: string): Promise<void> =>
    request<void>(`/api/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name },
    }),
  remove: (id: string): Promise<void> =>
    request<void>(`/api/folders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  markAllRead: (id: string): Promise<void> =>
    request<void>(`/api/folders/${encodeURIComponent(id)}/read-all`, {
      method: 'POST',
    }),
  listItems: (id: string, params: ListParams = {}): Promise<Page<FeedItem>> =>
    request<Page<FeedItem>>(`/api/folders/${encodeURIComponent(id)}/items`, {
      params: pageParams(params),
    }),
};

export const settingsApi = {
  get: (): Promise<Settings> => request<Settings>('/api/settings'),
  updateRetention: (retention: number): Promise<void> =>
    request<void>('/api/settings/retention', {
      method: 'PUT',
      body: { retention },
    }),
  updateProvider: (provider: ExtractorProvider): Promise<void> =>
    request<void>('/api/settings/provider', {
      method: 'PUT',
      body: { provider },
    }),
  saveJinaKey: (key: string): Promise<void> =>
    request<void>('/api/settings/services/jina', {
      method: 'PUT',
      body: { key },
    }),
  deleteJinaKey: (): Promise<void> =>
    request<void>('/api/settings/services/jina', { method: 'DELETE' }),
  saveBrowserEndpoint: (endpoint: string): Promise<void> =>
    request<void>('/api/settings/services/browser', {
      method: 'PUT',
      body: { endpoint },
    }),
  deleteBrowserEndpoint: (): Promise<void> =>
    request<void>('/api/settings/services/browser', { method: 'DELETE' }),
  saveSmtp: (input: SmtpSettingsInput): Promise<void> =>
    request<void>('/api/settings/services/smtp', {
      method: 'PUT',
      body: input,
    }),
  deleteSmtp: (): Promise<void> =>
    request<void>('/api/settings/services/smtp', { method: 'DELETE' }),
  deleteSmtpPassword: (): Promise<void> =>
    request<void>('/api/settings/services/smtp/password', {
      method: 'DELETE',
    }),
  updateKindle: (input: KindleSettings): Promise<void> =>
    request<void>('/api/settings/kindle', { method: 'PUT', body: input }),
};

export const kindleApi = {
  sendNow: (): Promise<KindleSendRecord> =>
    item<KindleSendRecord>('/api/kindle/send', { method: 'POST' }),
  listSends: (): Promise<KindleSends> =>
    request<KindleSends>('/api/kindle/sends'),
};
