import { type Accessor, onCleanup, onMount } from 'solid-js';
import {
  type Article,
  type Filter,
  type LibraryClient,
  library,
  type Scope,
} from '../lib/library';
import { createLibraryContext, dismissToast } from './library-context';
import { loadMore, refresh, setFilter, setScope } from './library-loading';
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
  readonly setScope: (scope: Scope) => Promise<void>;
  readonly setFilter: (filter: Filter) => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly openArticle: (id: string) => Promise<Article | undefined>;
  readonly clearSelection: () => void;
  readonly toggleRead: (article: Article) => Promise<void>;
  readonly markLoaded: () => Promise<void>;
  readonly markAll: () => Promise<void>;
  readonly remove: (article: Article) => Promise<boolean>;
  readonly save: (article: Article) => Promise<boolean>;
  readonly add: (url: string) => Promise<boolean>;
  readonly preview: (url: string) => Promise<PreviewResult>;
  readonly subscribe: (url: string) => Promise<boolean>;
  readonly unsubscribe: (id: string) => Promise<boolean>;
  readonly extract: (article: Article) => Promise<Article | undefined>;
  readonly dismissToast: () => void;
};

const REFRESH_INTERVAL = 30_000;

export const createLibraryModel = (
  client: LibraryClient = library
): LibraryModel => {
  const store = createLibraryContext(client);

  return {
    state: store.state,
    setScope: (scope) => setScope(store, scope),
    setFilter: (filter) => setFilter(store, filter),
    loadMore: () => loadMore(store),
    refresh: () => refresh(store),
    openArticle: (id) => openArticle(store, id),
    clearSelection: () => clearSelection(store),
    toggleRead: (article) => toggleRead(store, article),
    markLoaded: () => markLoaded(store),
    markAll: () => markAll(store),
    remove: (article) => removeArticle(store, article),
    save: (article) => saveArticle(store, article),
    add: (url) => addArticle(store, url),
    preview: (url) => previewUrl(store, url),
    subscribe: (url) => subscribeFeed(store, url),
    unsubscribe: (id) => unsubscribeFeed(store, id),
    extract: (article) => extractArticle(store, article),
    dismissToast: () => dismissToast(store),
  };
};

export const useLibraryModel = (
  client: LibraryClient = library
): LibraryModel => {
  const model = createLibraryModel(client);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
    }

    timer = undefined;
  };

  const start = () => {
    stop();
    timer = setInterval(() => {
      void model.refresh();
    }, REFRESH_INTERVAL);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stop();

      return;
    }

    start();
    void model.refresh();
  };

  onMount(() => {
    start();
    void model.refresh();
    document.addEventListener('visibilitychange', onVisibility);
  });

  onCleanup(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return model;
};

export { unreadCount } from './library-counts';

export type { PreviewResult } from './library-mutations';

export type { LibraryToast } from './library-state';

export { sameScope } from './library-state';
