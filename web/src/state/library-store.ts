/**
 * Shared reactive record store for library articles (`LIB-LIST-1`): articles are stored once by
 * ID in a fine-grained store, the list holds ordered IDs + cursor, and the reader derives from its
 * selected ID. Writes go through store drafts so a field change (for example `read`) only re-runs
 * the bindings that read that field; server data is reconciled so record identity is preserved.
 * Deep-linked records are retained independently of list membership and evicted when neither view
 * needs them.
 */

import { createSignal, createStore, flush, reconcile } from 'solid-js';
import type { FeedItem, SavedPage, SortOrder } from '../api';
import { pendingRead } from './read-sync';
import type { LibraryScope } from './scope';
import { onSessionCleared } from './session';
import { getItem, setItem } from './storage';

/** `CM-PAGE-1` / `LIB-LIST-1`: 30 rows per page. */
export const PAGE_SIZE = 30;

export type LibraryArticle =
  | ({ kind: 'later' } & SavedPage)
  | ({ kind: 'feed' } & FeedItem);

export interface LibraryArticlePatch {
  read?: boolean;
  extractedContent?: string;
}

/** Read-state context for an article that is not part of the loaded records. */
export interface ArticleReadFallback {
  kind: LibraryArticle['kind'];
  feedId?: string | null;
  read: boolean;
}

const [activeScope, setActiveScope] = createSignal<LibraryScope>({
  kind: 'later',
});
const [activeUnreadOnly, setActiveUnreadOnly] = createSignal(false);
const [activeOrder, setActiveOrder] = createSignal<SortOrder>('newest');

/** `FD-PREF-1`: order shared by the all-feeds, folder, and read-later lists; persisted locally. */
const LIST_ORDER_STORAGE_KEY = 'reader.listOrder';

const readListOrder = (): SortOrder =>
  getItem(LIST_ORDER_STORAGE_KEY) === 'oldest' ? 'oldest' : 'newest';

const [aggregateOrder, setAggregateOrderSignal] = createSignal<SortOrder>(
  readListOrder()
);

const setAggregateOrder = (next: SortOrder): void => {
  setAggregateOrderSignal(next);
  setItem(LIST_ORDER_STORAGE_KEY, next);
};

interface LibraryRecords {
  /** Article records by ID. */
  byId: Record<string, LibraryArticle>;
  /** Ordered IDs of the loaded list. */
  ids: Array<string>;
  /** Deep-linked reader article kept even when it is not part of the list. */
  retainedId: string | null;
}

const [records, setRecords] = createStore<LibraryRecords>({
  byId: {},
  ids: [],
  retainedId: null,
});
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
  setActiveOrder,
  setActiveScope,
  setActiveUnreadOnly,
  setAggregateOrder,
  setCursor,
  setLoadError,
  setLoadingInitial,
  setLoadingMore,
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

/** Ordered IDs of the loaded list; a store array, so readers track only what they read. */
export const rowIds = (): ReadonlyArray<string> => records.ids;

/** The article record (a store proxy with stable identity), or `null`. */
export const articleById = (articleId: string): LibraryArticle | null =>
  records.byId[articleId] ?? null;

export const hasRow = (articleId: string): boolean =>
  records.ids.includes(articleId);

export const retainedArticle = (): LibraryArticle | null => {
  const id = records.retainedId;
  if (id === null || hasRow(id)) return null;
  return articleById(id);
};

/** Loaded rows in list order. Allocates a new array: for one-off reads, not for rendering. */
export const rows = (): ReadonlyArray<LibraryArticle> => {
  const list: Array<LibraryArticle> = [];
  for (const id of records.ids) {
    const article = records.byId[id];
    if (article !== undefined) list.push(article);
  }
  return list;
};

const evictUnused = (draft: LibraryRecords): void => {
  const keep = new Set(draft.ids);
  if (draft.retainedId !== null) keep.add(draft.retainedId);
  for (const id of Object.keys(draft.byId)) {
    if (!keep.has(id)) delete draft.byId[id];
  }
};

/**
 * Merges a server snapshot into the store. The read state of an article with a pending read
 * request stays at the user's latest intent, and extracted content fetched after the snapshot was
 * dispatched is kept.
 */
const mergeRecord = (draft: LibraryRecords, incoming: LibraryArticle): void => {
  const existing = draft.byId[incoming.id];
  const intent = pendingRead(incoming.id);
  const merged: LibraryArticle =
    intent === undefined ? { ...incoming } : { ...incoming, read: intent };
  if (
    merged.kind === 'feed' &&
    existing?.kind === 'feed' &&
    merged.extractedContent === undefined &&
    existing.extractedContent !== undefined
  ) {
    merged.extractedContent = existing.extractedContent;
  }

  if (existing === undefined) {
    draft.byId[incoming.id] = merged;
  } else {
    reconcile(merged, 'id')(existing);
  }
};

const appendUnique = (
  draft: LibraryRecords,
  items: ReadonlyArray<LibraryArticle>
): void => {
  const seen = new Set(draft.ids);
  for (const item of items) {
    mergeRecord(draft, item);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    draft.ids.push(item.id);
  }
};

export const retainReaderArticle = (articleId: string | null): void => {
  setRecords((draft) => {
    if (draft.retainedId === articleId) return;
    draft.retainedId = articleId;
    evictUnused(draft);
  });
};

export const upsertArticle = (article: LibraryArticle): void => {
  setRecords((draft) => {
    mergeRecord(draft, article);
  });
};

export const clearRows = (): void => {
  setRecords((draft) => {
    draft.ids.length = 0;
    evictUnused(draft);
  });
};

export const replaceRows = (items: ReadonlyArray<LibraryArticle>): void => {
  setRecords((draft) => {
    draft.ids.length = 0;
    appendUnique(draft, items);
    evictUnused(draft);
  });
};

export const appendRows = (items: ReadonlyArray<LibraryArticle>): void => {
  setRecords((draft) => {
    appendUnique(draft, items);
  });
};

export const prependRow = (article: LibraryArticle): void => {
  setRecords((draft) => {
    if (draft.ids.includes(article.id)) return;
    mergeRecord(draft, article);
    draft.ids.unshift(article.id);
  });
};

export const appendRow = (article: LibraryArticle): void => {
  setRecords((draft) => {
    if (draft.ids.includes(article.id)) return;
    mergeRecord(draft, article);
    draft.ids.push(article.id);
  });
};

export const removeRow = (articleId: string): void => {
  setRecords((draft) => {
    const index = draft.ids.indexOf(articleId);
    if (index < 0) return;
    draft.ids.splice(index, 1);
    evictUnused(draft);
  });
};

/** Removes a feed's rows and returns them with the previous order, for a later restore. */
export const dropFeedRows = (
  feedId: string
): {
  rows: ReadonlyArray<LibraryArticle>;
  orderIds: ReadonlyArray<string>;
} => {
  let orderIds: Array<string> = [];
  const dropped: Array<LibraryArticle> = [];
  setRecords((draft) => {
    orderIds = [...draft.ids];
    draft.ids = draft.ids.filter((id) => {
      const article = draft.byId[id];
      if (article?.kind !== 'feed' || article.feedId !== feedId) return true;
      dropped.push({ ...article });
      return false;
    });
    evictUnused(draft);
  });
  return { rows: dropped, orderIds };
};

export const restoreFeedRows = (
  removed: ReadonlyArray<LibraryArticle>,
  previousOrderIds: ReadonlyArray<string>
): void => {
  setRecords((draft) => {
    const present = new Set(draft.ids);
    const missing = removed.filter((item) => !present.has(item.id));
    if (missing.length === 0) return;

    const positions = new Map(previousOrderIds.map((id, index) => [id, index]));
    const position = (id: string): number =>
      positions.get(id) ?? Number.MAX_SAFE_INTEGER;
    for (const item of missing) {
      mergeRecord(draft, item);
      const at = draft.ids.findIndex((id) => position(id) > position(item.id));
      draft.ids.splice(at < 0 ? draft.ids.length : at, 0, item.id);
    }
  });
};

export const patchArticle = (
  articleId: string,
  patch: LibraryArticlePatch
): void => {
  setRecords((draft) => {
    const article = draft.byId[articleId];
    if (article === undefined) return;
    if (patch.read !== undefined) article.read = patch.read;
    if (patch.extractedContent !== undefined && article.kind === 'feed') {
      article.extractedContent = patch.extractedContent;
    }
  });
};

export const clearLibraryStoreState = (): void => {
  requestState.generation += 1;
  requestState.pageInFlight = false;
  setRecords((draft) => {
    draft.ids.length = 0;
    draft.retainedId = null;
    evictUnused(draft);
  });
  setActiveScope({ kind: 'later' });
  setActiveUnreadOnly(false);
  setActiveOrder('newest');
  setCursor(null);
  setLoadingInitial(false);
  setLoadingMore(false);
  setLoadError(null);
  flush();
};

onSessionCleared(clearLibraryStoreState);
