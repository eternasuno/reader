import {
  addSavedPage,
  createFolder,
  extractFeedItem,
  markAllFeeds,
  markArticles,
  markFeeds,
  markFolders,
  markLater,
  markRead,
  moveFeed,
  readArticle,
  readFeeds,
  readFolders,
  readPage,
  readPreview,
  readSavedPageByUrl,
  readSubscription,
  readUnreadCounts,
  removeFolder,
  removeSavedPage,
  removeSubscription,
  renameFolder,
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
    folders: () => readFolders(send),
    createFolder: (name: string) => createFolder(send, name),
    renameFolder: (id: string, name: string) => renameFolder(send, id, name),
    removeFolder: (id: string) => removeFolder(send, id),
    moveFeed: (feedId: string, folderId: string | undefined) =>
      moveFeed(send, feedId, folderId),
    markFolders: (folderIds: ReadonlyArray<string>) =>
      markFolders(send, folderIds),
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
    subscribe: (url: string, title: string, folderId?: string) =>
      readSubscription(send, url, title, folderId),
    unsubscribe: (id: string) => removeSubscription(send, id),
  };
};

export type LibraryClient = ReturnType<typeof createLibraryClient>;

export const library: LibraryClient = createLibraryClient();
