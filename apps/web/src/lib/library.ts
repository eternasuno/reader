import {
  addSavedPage,
  extractFeedItem,
  markAllFeeds,
  markArticles,
  markFeeds,
  markLater,
  markRead,
  readArticle,
  readFeeds,
  readPage,
  readPreview,
  readSavedPageByUrl,
  readSubscription,
  readUnreadCounts,
  removeSavedPage,
  removeSubscription,
  saveFeedItem,
} from './library-requests';
import { createSend, type LibraryClientOptions } from './library-transport';
import type { Article, ArticleRef, Scope } from './library-types';

export * from './library-error';
export { refOf } from './library-requests';
export * from './library-schema';
export type { FetchLike, LibraryClientOptions } from './library-transport';
export * from './library-types';

export const createLibraryClient = (options: LibraryClientOptions = {}) => {
  const send = createSend(options);

  return {
    list: (scope: Scope, unreadOnly: boolean, cursor?: string) =>
      readPage(send, scope, unreadOnly, cursor),
    feeds: () => readFeeds(send),
    unreadCounts: () => readUnreadCounts(send),
    article: (ref: ArticleRef) => readArticle(send, ref),
    findSavedPageByUrl: (url: string) => readSavedPageByUrl(send, url),
    markRead: (ref: ArticleRef, read: boolean) => markRead(send, ref, read),
    markLater: () => markLater(send),
    markAllFeeds: () => markAllFeeds(send),
    markFeeds: (feedIds: ReadonlyArray<string>) => markFeeds(send, feedIds),
    markArticles: (refs: ReadonlyArray<ArticleRef>) => markArticles(send, refs),
    remove: (id: string) => removeSavedPage(send, id),
    save: (article: Article) => saveFeedItem(send, article),
    add: (url: string) => addSavedPage(send, url),
    extract: (article: Article) => extractFeedItem(send, article),
    preview: (url: string) => readPreview(send, url),
    subscribe: (url: string, title: string) =>
      readSubscription(send, url, title),
    unsubscribe: (id: string) => removeSubscription(send, id),
  };
};

export type LibraryClient = ReturnType<typeof createLibraryClient>;

export const library: LibraryClient = createLibraryClient();
