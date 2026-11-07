import {
  markArticles,
  markFeeds,
  markLater,
  markRead,
  readArticleByRef,
  readFeedItem,
  readFeeds,
  readPage,
  readPreview,
  readRefresh,
  readSavedPage,
  readSubscription,
  readUnreadCounts,
  refOf,
  removeSavedPage,
  removeSubscription,
} from './library-requests';
import { createSend, type LibraryClientOptions } from './library-transport';
import type { Article, ArticleRef, Filter, Scope } from './library-types';

export * from './library-error';
export { refOf } from './library-requests';
export * from './library-schema';
export type { FetchLike, LibraryClientOptions } from './library-transport';
export * from './library-types';

export const createLibraryClient = (options: LibraryClientOptions = {}) => {
  const send = createSend(options);

  return {
    list: (scope: Scope, filter: Filter, cursor?: string) =>
      readPage(send, scope, filter, cursor),
    refresh: (scope: Scope, filter: Filter, through: string) =>
      readRefresh(send, scope, filter, through),
    feeds: () => readFeeds(send),
    unreadCounts: () => readUnreadCounts(send),
    article: (ref: ArticleRef) => readArticleByRef(send, ref),
    markRead: (ref: ArticleRef, read: boolean) => markRead(send, ref, read),
    markLater: () => markLater(send),
    markFeeds: (feedIds: ReadonlyArray<string>) => markFeeds(send, feedIds),
    markArticles: (refs: ReadonlyArray<ArticleRef>) => markArticles(send, refs),
    remove: (id: string) => removeSavedPage(send, id),
    save: (article: Article) => {
      const { id, feedId } = refOf(article);

      return feedId === undefined
        ? Promise.resolve(article)
        : readSavedPage(send, '/api/library/saved-pages/from-feed-item', {
            feedId,
            id,
          });
    },
    add: (url: string) =>
      readSavedPage(send, '/api/library/saved-pages', { url }),
    extract: (article: Article) => {
      const { id, feedId } = refOf(article);

      return feedId === undefined
        ? Promise.resolve(article)
        : readFeedItem(send, '/api/library/feeds/items/extract', {
            feedId,
            id,
          });
    },
    preview: (url: string) => readPreview(send, url),
    subscribe: (url: string) => readSubscription(send, url),
    unsubscribe: (id: string) => removeSubscription(send, id),
  };
};

export type LibraryClient = ReturnType<typeof createLibraryClient>;

export const library: LibraryClient = createLibraryClient();
