/**
 * Shared reactive store for the library list (`LIB-LIST-1`): active scope/filter/order, loaded
 * rows, paging cursors, request generations and the optimistic-patch listener. The loaders
 * (`library.ts`) and the row actions (`library-actions.ts`) share one signal set through this
 * module, so neither has to import the other.
 */

import { createSignal } from 'solid-js';
import type { FeedItem, SavedPage, SortOrder } from '../api';
import type { LibraryScope } from './scope';

/** `CM-PAGE-1` / `LIB-LIST-1`: 30 rows per page. */
export const PAGE_SIZE = 30;

export type LibraryArticle =
  | ({ kind: 'later' } & SavedPage)
  | ({ kind: 'feed' } & FeedItem);

export interface LibraryArticlePatch {
  read?: boolean;
  extractedContent?: string;
}

/** Read-state context for an article that is not part of the loaded rows (deep link). */
export interface ArticleReadFallback {
  kind: LibraryArticle['kind'];
  feedId?: string | null;
  read: boolean;
}

type ArticlePatchListener = (
  articleId: string,
  patch: LibraryArticlePatch
) => void;

const [activeScope, setActiveScope] = createSignal<LibraryScope>({
  kind: 'later',
});
const [activeUnreadOnly, setActiveUnreadOnly] = createSignal(false);
const [activeOrder, setActiveOrder] = createSignal<SortOrder>('newest');

/** `FD-PREF-1`: order shared by the all-feeds, folder, and read-later lists; persisted locally. */
const LIST_ORDER_STORAGE_KEY = 'reader.listOrder';

const readListOrder = (): SortOrder => {
  if (typeof localStorage === 'undefined') return 'newest';

  try {
    return localStorage.getItem(LIST_ORDER_STORAGE_KEY) === 'oldest'
      ? 'oldest'
      : 'newest';
  } catch {
    return 'newest';
  }
};

const [aggregateOrder, setAggregateOrderSignal] = createSignal<SortOrder>(
  readListOrder()
);

const setAggregateOrder = (next: SortOrder): void => {
  setAggregateOrderSignal(next);
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LIST_ORDER_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable; the in-memory choice still applies.
  }
};
const [rows, setRows] = createSignal<ReadonlyArray<LibraryArticle>>([]);
const [cursor, setCursor] = createSignal<string | null>(null);
const [loadingInitial, setLoadingInitial] = createSignal(false);
const [loadingMore, setLoadingMore] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);

export {
  activeOrder,
  activeScope,
  activeUnreadOnly,
  aggregateOrder,
  cursor,
  loadError,
  loadingInitial,
  loadingMore,
  rows,
  setActiveOrder,
  setActiveScope,
  setActiveUnreadOnly,
  setAggregateOrder,
  setCursor,
  setLoadError,
  setLoadingInitial,
  setLoadingMore,
  setRows,
};

/**
 * `LIB-RELOAD-1`: `generation` discards stale page responses from an earlier scope/filter/order;
 * `pageInFlight` keeps at most one next-page request alive (`LIB-LIST-1`).
 */
export const requestState = { generation: 0, pageInFlight: false };

/**
 * `activeScope()` outlives the library page, so background work checks whether a library page is
 * still mounted. Pages remount when the scope kind changes, so mounts are counted.
 */
let libraryMounts = 0;

/** Called by the library page on mount; the returned release runs on unmount. */
export const trackLibraryMount = (): (() => void) => {
  libraryMounts += 1;

  return () => {
    libraryMounts -= 1;
  };
};

export const isLibraryMounted = (): boolean => libraryMounts > 0;

/**
 * The reader registers a listener so optimistic row patches also reach `openArticle()`. A callback
 * keeps the module graph one-directional (reader -> library).
 */
let articlePatchListener: ArticlePatchListener | null = null;

export const setOnArticlePatched = (
  listener: ArticlePatchListener | null
): void => {
  articlePatchListener = listener;
};

export const notifyArticlePatched = (
  articleId: string,
  patch: LibraryArticlePatch
): void => {
  articlePatchListener?.(articleId, patch);
};
