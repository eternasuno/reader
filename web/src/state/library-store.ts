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
  | ({ kind: 'later'; sourceTitle: string } & SavedPage)
  | ({ kind: 'feed'; sourceTitle: string } & FeedItem);

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
const [rows, setRows] = createSignal<ReadonlyArray<LibraryArticle>>([]);
const [cursor, setCursor] = createSignal<string | null>(null);
const [loadingInitial, setLoadingInitial] = createSignal(false);
const [loadingMore, setLoadingMore] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);

export {
  activeOrder,
  activeScope,
  activeUnreadOnly,
  cursor,
  loadError,
  loadingInitial,
  loadingMore,
  rows,
  setActiveOrder,
  setActiveScope,
  setActiveUnreadOnly,
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
