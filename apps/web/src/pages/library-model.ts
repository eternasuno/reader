import type { Accessor } from 'solid-js';
import {
  type Article,
  type LibraryClient,
  library,
  type Scope,
} from '../lib/library';
import { createLibraryContext, dismissToast } from './library-context';
import {
  enter,
  loadMore,
  refresh,
  setFilter,
  setScope,
} from './library-loading';
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
} from './library-mutations';
import { markAll, markLoaded } from './library-read';
import { clearSelection, openArticle } from './library-selection';
import type { LibraryState } from './library-state';

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
  readonly subscribe: (url: string, title: string) => Promise<boolean>;
  readonly unsubscribe: (id: string) => Promise<boolean>;
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
    subscribe: (url, title) => subscribeFeed(store, url, title),
    unsubscribe: (id) => unsubscribeFeed(store, id),
    extract: (article) => extractArticle(store, article),
    dismissToast: () => dismissToast(store),
  };
};

export const useLibraryModel = (
  client: LibraryClient = library
): LibraryModel => createLibraryModel(client);

export { unreadCount } from './library-counts';

export type { PreviewResult } from './library-mutations';

export type { LibraryToast } from './library-state';

export { isBusy, sameScope } from './library-state';
