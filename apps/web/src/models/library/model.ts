import type { Accessor } from 'solid-js';
import {
  type Article,
  type LibraryClient,
  library,
  type Scope,
} from '../../api/library';
import { createLibraryContext, dismissToast } from './context';
import {
  createFolder,
  moveFeed,
  removeFolder,
  renameFolder,
} from './folder-mutations';
import { enter, loadMore, refresh, setFilter, setScope } from './loading';
import {
  addArticle,
  extractArticle,
  type PreviewResult,
  previewUrl,
  removeArticle,
  saveArticle,
  subscribeFeed,
  toggleRead,
  unsubscribeFeed,
} from './mutations';
import { markAll, markLoaded } from './read';
import { clearSelection, openArticle } from './selection';
import type { LibraryState } from './state';

export type LibraryModel = {
  readonly state: Accessor<LibraryState>;
  readonly enter: (scope: Scope) => Promise<void>;
  readonly setScope: (scope: Scope) => Promise<void>;
  readonly setFilter: (unreadOnly: boolean) => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly openArticle: (
    id: string,
    feedId?: string
  ) => Promise<Article | undefined>;
  readonly clearSelection: () => void;
  readonly toggleRead: (article: Article) => Promise<void>;
  readonly markLoaded: () => Promise<void>;
  readonly markAll: () => Promise<void>;
  readonly remove: (article: Article) => Promise<boolean>;
  readonly save: (article: Article) => Promise<boolean>;
  readonly add: (url: string) => Promise<boolean>;
  readonly preview: (url: string) => Promise<PreviewResult>;
  readonly subscribe: (
    url: string,
    title: string,
    folderId?: string
  ) => Promise<boolean>;
  readonly unsubscribe: (id: string) => Promise<boolean>;
  readonly createFolder: (name: string) => Promise<boolean>;
  readonly renameFolder: (id: string, name: string) => Promise<boolean>;
  readonly removeFolder: (id: string) => Promise<boolean>;
  readonly moveFeed: (
    feedId: string,
    folderId: string | undefined
  ) => Promise<boolean>;
  readonly extract: (article: Article) => Promise<Article | undefined>;
  readonly dismissToast: () => void;
};

export const createLibraryModel = (
  client: LibraryClient = library
): LibraryModel => {
  const store = createLibraryContext(client);

  return {
    state: store.state,
    enter: (scope) => enter(store, scope),
    setScope: (scope) => setScope(store, scope),
    setFilter: (unreadOnly) => setFilter(store, unreadOnly),
    loadMore: () => loadMore(store),
    refresh: () => refresh(store),
    openArticle: (id, feedId) => openArticle(store, id, feedId),
    clearSelection: () => clearSelection(store),
    toggleRead: (article) => toggleRead(store, article),
    markLoaded: () => markLoaded(store),
    markAll: () => markAll(store),
    remove: (article) => removeArticle(store, article),
    save: (article) => saveArticle(store, article),
    add: (url) => addArticle(store, url),
    preview: (url) => previewUrl(store, url),
    subscribe: (url, title, folderId) =>
      subscribeFeed(store, url, title, folderId),
    unsubscribe: (id) => unsubscribeFeed(store, id),
    createFolder: (name) => createFolder(store, name),
    renameFolder: (id, name) => renameFolder(store, id, name),
    removeFolder: (id) => removeFolder(store, id),
    moveFeed: (feedId, folderId) => moveFeed(store, feedId, folderId),
    extract: (article) => extractArticle(store, article),
    dismissToast: () => dismissToast(store),
  };
};

export const useLibraryModel = (
  client: LibraryClient = library
): LibraryModel => createLibraryModel(client);
