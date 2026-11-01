import {
  markArticles,
  markFeeds,
  markLater,
  markRead,
  readArticle,
  readArticleById,
  readFeeds,
  readFeedUnread,
  readLaterUnread,
  readPage,
  readPreview,
  readRefresh,
  readSubscription,
  removeArticle,
  removeSubscription,
} from './library-requests';
import { createSend, type LibraryClientOptions } from './library-transport';
import type { Filter, Scope } from './library-types';

export * from './library-error';
export * from './library-schema';
export type { FetchLike, LibraryClientOptions } from './library-transport';
export * from './library-types';

export const createLibraryClient = (options: LibraryClientOptions = {}) => {
  const send = createSend(options);
  const article = (path: string, body: unknown) =>
    readArticle(send, path, body);

  return {
    list: (scope: Scope, filter: Filter, cursor?: string) =>
      readPage(send, scope, filter, cursor),
    refresh: (scope: Scope, filter: Filter, through: string) =>
      readRefresh(send, scope, filter, through),
    feeds: () => readFeeds(send),
    laterUnread: () => readLaterUnread(send),
    feedUnread: () => readFeedUnread(send),
    article: (id: string) => readArticleById(send, id),
    markRead: (id: string, read: boolean) => markRead(send, id, read),
    markLater: () => markLater(send),
    markFeeds: (feedIds: readonly string[]) => markFeeds(send, feedIds),
    markArticles: (ids: readonly string[]) => markArticles(send, ids),
    remove: (id: string) => removeArticle(send, id),
    save: (id: string) => article('/api/library/articles/save', { id }),
    add: (url: string) => article('/api/library/articles', { url }),
    extract: (id: string) => article('/api/library/articles/extract', { id }),
    preview: (url: string) => readPreview(send, url),
    subscribe: (url: string) => readSubscription(send, url),
    unsubscribe: (id: string) => removeSubscription(send, id),
  };
};

export type LibraryClient = ReturnType<typeof createLibraryClient>;

export const library: LibraryClient = createLibraryClient();
