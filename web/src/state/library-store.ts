import { createStore, flush, reconcile } from 'solid-js';
import type { FeedItem, SavedPage } from '../api';
import { feedMoveTracker } from './library-mutations';
import {
  clearList,
  prependListId,
  removeListIds as removeSnapshotIds,
  requestState,
  rowIds,
  setActiveScope,
  setActiveUnreadOnly,
  setSnapshotError,
  setSnapshotLoading,
  setWindowError,
  snapshotIds,
} from './library-snapshot';

export {
  acceptSnapshot,
  activeScope,
  activeUnreadOnly,
  changesRows,
  feedIdOf,
  folderMoveChangesRows,
  groupStartIds,
  idsThroughVisibleEnd,
  isLibraryMounted,
  listBoundary,
  listRevision,
  replaceSnapshot,
  requestState,
  routeArticleId,
  rowIds,
  setActiveScope,
  setActiveUnreadOnly,
  setRouteArticleId,
  setSnapshotError,
  setSnapshotLoading,
  setVisibleRange,
  setWindowError,
  snapshotError,
  snapshotIds,
  snapshotLoading,
  trackLibraryMount,
  updateFolderMembership,
  windowError,
} from './library-snapshot';

import {
  dropIdleUnknownEntry,
  hasActiveEntry,
  mergeSnapshotRead,
} from './read-sync-state';
import type { LibraryScope } from './scope';
import { onSessionCleared } from './session';

export type LibraryArticle =
  | ({ kind: 'later' } & SavedPage)
  | ({ kind: 'feed' } & FeedItem);

export const articleKindOf = (scope: LibraryScope): LibraryArticle['kind'] =>
  scope.kind === 'later' ? 'later' : 'feed';

export const toLibraryArticle = (
  kind: LibraryArticle['kind'],
  item: SavedPage | FeedItem
): LibraryArticle =>
  kind === 'later'
    ? { ...(item as SavedPage), kind: 'later' }
    : { ...(item as FeedItem), kind: 'feed' };

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

type LibraryRecords = {
  byId: Record<string, LibraryArticle>;
  retainedId: string | null;
};

type RecordFreshness = { seq?: number; stale: boolean };

const CACHE_BUDGET = 1000;
const [records, setRecords] = createStore<LibraryRecords>({
  byId: {},
  retainedId: null,
});
const freshness = new Map<string, RecordFreshness>();
let cacheWindow: { start: number; end: number } | null = null;

export const articleById = (articleId: string): LibraryArticle | null =>
  records.byId[articleId] ?? null;

export const needsWindowRecord = (id: string): boolean => {
  const record = freshness.get(id);
  return record === undefined || record.stale;
};

export const markRecordsStale = (): void => {
  for (const record of freshness.values()) record.stale = true;
};

const deleteRecord = (draft: LibraryRecords, id: string): void => {
  delete draft.byId[id];
  freshness.delete(id);
  dropIdleUnknownEntry(id);
};

const isPinned = (draft: LibraryRecords, id: string): boolean => {
  if (draft.retainedId === id || hasActiveEntry(id)) return true;

  const article = draft.byId[id];
  return (
    article.kind === 'feed' && feedMoveTracker.hasPendingMove(article.feedId)
  );
};

const evictRecords = (draft: LibraryRecords): void => {
  if (freshness.size <= CACHE_BUDGET) return;

  const evictable = [...freshness.keys()].filter((id) => !isPinned(draft, id));
  const excess = evictable.length - CACHE_BUDGET;
  if (excess <= 0) return;

  const positions = new Map(rowIds().map((id, index) => [id, index]));
  const distance = (id: string): number => {
    const index = positions.get(id);
    if (index === undefined || cacheWindow === null)
      return Number.MAX_SAFE_INTEGER;

    return Math.max(cacheWindow.start - index, index - cacheWindow.end, 0);
  };
  evictable.sort((a, b) => distance(b) - distance(a));
  for (const id of evictable.slice(0, excess)) deleteRecord(draft, id);
};

export const setCacheWindow = (range: typeof cacheWindow): void => {
  cacheWindow = range;
};

export const trimRecordCache = (): void => {
  setRecords(evictRecords);
};

/**
 * Merges a server snapshot into the store. The read state of an article with a pending read
 * request stays at the user's latest intent, and extracted content fetched after the snapshot was
 * dispatched is kept.
 */
const mergeRecord = (
  draft: LibraryRecords,
  incoming: LibraryArticle,
  snapshotSeq?: number,
  stale = false
): void => {
  if (snapshotSeq !== undefined && hasNewerRecord(incoming.id, snapshotSeq))
    return;

  freshness.set(incoming.id, { seq: snapshotSeq, stale });
  const existing = draft.byId[incoming.id];
  const read = mergeSnapshotRead(incoming, snapshotSeq);
  const merged: LibraryArticle =
    read === incoming.read ? { ...incoming } : { ...incoming, read };
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

export const retainReaderArticle = (articleId: string | null): void => {
  setRecords((draft) => {
    const previous = draft.retainedId;
    if (previous === articleId) return;

    draft.retainedId = articleId;
    if (
      previous !== null &&
      draft.byId[previous] !== undefined &&
      !snapshotIds().includes(previous) &&
      !isPinned(draft, previous)
    ) {
      deleteRecord(draft, previous);
    }

    evictRecords(draft);
  });
};

export const upsertArticle = (
  article: LibraryArticle,
  snapshotSeq?: number
): void => {
  setRecords((draft) => {
    mergeRecord(draft, article, snapshotSeq);
    evictRecords(draft);
  });
};

export const mergeWindowRecords = (
  items: ReadonlyArray<LibraryArticle>,
  seq: number,
  stale: boolean
): void => {
  setRecords((draft) => {
    for (const item of items) mergeRecord(draft, item, seq, stale);
    evictRecords(draft);
  });
};

export const clearRows = (): void => {
  cacheWindow = null;
  clearList();
  setRecords((draft) => {
    for (const [id, record] of freshness) {
      if (id === draft.retainedId) record.stale = true;
      else deleteRecord(draft, id);
    }
  });
};

export const prependRow = (article: LibraryArticle, seq: number): boolean => {
  if (snapshotIds().includes(article.id) && articleById(article.id) !== null)
    return false;

  prependListId(article.id);
  setRecords((draft) => {
    mergeRecord(draft, article, seq);
    evictRecords(draft);
  });
  return true;
};

export const hasNewerRecord = (id: string, seq: number): boolean =>
  (freshness.get(id)?.seq ?? -1) > seq;

export const removeListIds = (ids: ReadonlyArray<string>): void => {
  removeSnapshotIds(ids);
  setRecords((draft) => {
    for (const id of ids) {
      if (id !== draft.retainedId) deleteRecord(draft, id);
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

const clearLibraryStoreState = (): void => {
  requestState.generation += 1;
  setRecords((draft) => {
    draft.retainedId = null;
  });
  flush();
  clearRows();
  setActiveScope({ kind: 'later' });
  setActiveUnreadOnly(false);
  setSnapshotLoading(false);
  setSnapshotError(null);
  setWindowError(null);
  flush();
};

onSessionCleared(clearLibraryStoreState);
