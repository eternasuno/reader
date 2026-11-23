/**
 * Shared reactive record store for library articles (`LIB-LIST-1`): articles are stored once by
 * ID, the list holds ordered IDs + cursor, and the reader derives from its selected ID.
 * Deep-linked records are retained independently of list membership and evicted when neither view
 * needs them.
 */

import { createSignal, flush } from 'solid-js';
import type { FeedItem, SavedPage, SortOrder } from '../api';
import { articleSnapshotGuard } from './library-mutations';
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

const [articlesById, setArticlesById] = createSignal<
  Readonly<Record<string, LibraryArticle>>
>({});
const [rowIds, setRowIdsSignal] = createSignal<ReadonlyArray<string>>([]);
const [cursor, setCursor] = createSignal<string | null>(null);
const [loadingInitial, setLoadingInitial] = createSignal(false);
const [loadingMore, setLoadingMore] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);

let latestRowIds: ReadonlyArray<string> = [];
let retainedReaderId: string | null = null;

export const captureMutationVersion = (): number =>
  articleSnapshotGuard.capture();

const setRowIds = (
  next:
    | ReadonlyArray<string>
    | ((current: ReadonlyArray<string>) => ReadonlyArray<string>)
): ReadonlyArray<string> => {
  const resolved = typeof next === 'function' ? next(latestRowIds) : next;
  latestRowIds = resolved;
  setRowIdsSignal(resolved);
  return resolved;
};

export {
  activeOrder,
  activeScope,
  activeUnreadOnly,
  aggregateOrder,
  cursor,
  loadError,
  loadingInitial,
  loadingMore,
  rowIds,
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

export const articleById = (articleId: string): LibraryArticle | null =>
  articlesById()[articleId] ?? null;

export const hasRow = (articleId: string): boolean =>
  latestRowIds.includes(articleId);

export const retainedArticle = (): LibraryArticle | null => {
  if (retainedReaderId === null || hasRow(retainedReaderId)) return null;
  return articleById(retainedReaderId);
};

export const rows = (): ReadonlyArray<LibraryArticle> => {
  const records = articlesById();
  const list: Array<LibraryArticle> = [];
  for (const id of rowIds()) {
    const article = records[id];
    if (article !== undefined) list.push(article);
  }
  return list;
};

const evictUnusedArticles = (keepIds: ReadonlyArray<string>): void => {
  const keep = new Set(keepIds);
  if (retainedReaderId !== null) keep.add(retainedReaderId);

  setArticlesById((current) => {
    let changed = false;
    const next: Record<string, LibraryArticle> = {};
    for (const [id, article] of Object.entries(current)) {
      if (keep.has(id)) {
        next[id] = article;
      } else {
        changed = true;
        articleSnapshotGuard.evict(id);
      }
    }
    return changed ? next : current;
  });
};

export const retainReaderArticle = (articleId: string | null): void => {
  if (retainedReaderId === articleId) return;
  retainedReaderId = articleId;
  evictUnusedArticles(latestRowIds);
};

const storeRecords = (
  items: ReadonlyArray<LibraryArticle>,
  dispatchVersion?: number
): void => {
  if (items.length === 0) return;

  setArticlesById((current) => {
    const next = { ...current };
    for (const item of items) {
      next[item.id] = articleSnapshotGuard.merge(
        item,
        current[item.id],
        dispatchVersion
      );
    }
    return next;
  });
};

export const upsertArticle = (
  article: LibraryArticle,
  dispatchVersion?: number
): void => {
  storeRecords([article], dispatchVersion);
};

const dedupeItems = (
  items: ReadonlyArray<LibraryArticle>,
  exclude: ReadonlySet<string> = new Set()
): Array<LibraryArticle> => {
  const seen = new Set(exclude);
  const unique: Array<LibraryArticle> = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
};

export const clearRows = (): void => {
  const nextIds = setRowIds([]);
  evictUnusedArticles(nextIds);
};

export const replaceRows = (
  items: ReadonlyArray<LibraryArticle>,
  dispatchVersion?: number
): void => {
  const unique = dedupeItems(items);
  storeRecords(unique, dispatchVersion);
  const nextIds = setRowIds(unique.map((item) => item.id));
  evictUnusedArticles(nextIds);
};

export const appendRows = (
  items: ReadonlyArray<LibraryArticle>,
  dispatchVersion?: number
): void => {
  const unique = dedupeItems(items, new Set(latestRowIds));
  if (unique.length === 0) return;

  storeRecords(unique, dispatchVersion);
  setRowIds((current) => [...current, ...unique.map((item) => item.id)]);
};

export const prependRow = (article: LibraryArticle): void => {
  if (hasRow(article.id)) return;
  storeRecords([article]);
  setRowIds((current) => [article.id, ...current]);
};

export const appendRow = (article: LibraryArticle): void => {
  if (hasRow(article.id)) return;
  storeRecords([article]);
  setRowIds((current) => [...current, article.id]);
};

export const removeRow = (articleId: string): void => {
  if (!hasRow(articleId)) return;
  const nextIds = setRowIds((current) =>
    current.filter((id) => id !== articleId)
  );
  evictUnusedArticles(nextIds);
};

export const dropFeedRows = (feedId: string): void => {
  const records = articlesById();
  const nextIds = setRowIds((current) =>
    current.filter((id) => {
      const article = records[id];
      return !(article?.kind === 'feed' && article.feedId === feedId);
    })
  );
  evictUnusedArticles(nextIds);
};

export const restoreFeedRows = (
  removed: ReadonlyArray<LibraryArticle>,
  previousOrderIds: ReadonlyArray<string>
): void => {
  const missing = dedupeItems(removed, new Set(latestRowIds));
  if (missing.length === 0) return;

  storeRecords(missing);
  const positions = new Map(previousOrderIds.map((id, index) => [id, index]));
  setRowIds((current) =>
    [...current, ...missing.map((item) => item.id)].sort(
      (left, right) =>
        (positions.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right) ?? Number.MAX_SAFE_INTEGER)
    )
  );
};

export const patchArticle = (
  articleId: string,
  patch: LibraryArticlePatch
): void => {
  setArticlesById((current) => {
    const existing = current[articleId];
    if (existing === undefined) return current;
    articleSnapshotGuard.record(articleId, patch);
    return {
      ...current,
      [articleId]: { ...existing, ...patch } as LibraryArticle,
    };
  });
};

export const patchManyArticles = (
  updates: ReadonlyArray<{ id: string; patch: LibraryArticlePatch }>
): void => {
  if (updates.length === 0) return;

  setArticlesById((current) => {
    let next: Record<string, LibraryArticle> | null = null;
    for (const { id, patch } of updates) {
      const existing = (next ?? current)[id];
      if (existing === undefined) continue;
      articleSnapshotGuard.record(id, patch);
      next ??= { ...current };
      next[id] = { ...existing, ...patch } as LibraryArticle;
    }
    return next ?? current;
  });
};

export const clearLibraryStoreState = (): void => {
  requestState.generation += 1;
  requestState.pageInFlight = false;
  retainedReaderId = null;
  articleSnapshotGuard.reset();
  setRowIds([]);
  setArticlesById({});
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
