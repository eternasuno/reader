/**
 * Shared reactive record store for library articles (`LIB-LIST-1`): articles are stored once by
 * ID in a fine-grained store, the list holds loaded IDs, and the reader derives from its
 * selected ID. Writes go through store drafts so a field change (for example `read`) only re-runs
 * the bindings that read that field; server data is reconciled so record identity is preserved.
 * Deep-linked records are retained independently of list membership and evicted when neither view
 * needs them. Rows dropped by a pending feed move stay pinned until the move settles.
 */

import {
  createMemo,
  createSignal,
  createStore,
  flush,
  reconcile,
} from 'solid-js';
import type { FeedItem, SavedPage } from '../api';
import {
  hasQueuedFeed,
  resetQueue,
  setFolderMembership,
  snapshotPosition,
} from './library-queue';
import { mergeSnapshotRead } from './read-sync';
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

const [activeScope, setActiveScope] = createSignal<LibraryScope>({
  kind: 'later',
});
const [activeUnreadOnly, setActiveUnreadOnly] = createSignal(false);
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
const [listBoundary, setListBoundary] = createSignal<string | null>(null);
const [loadingInitial, setLoadingInitial] = createSignal(false);
const [loadingMore, setLoadingMore] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);

export {
  activeScope,
  activeUnreadOnly,
  listBoundary,
  loadError,
  loadingInitial,
  loadingMore,
  setActiveScope,
  setActiveUnreadOnly,
  setListBoundary,
  setLoadError,
  setLoadingInitial,
  setLoadingMore,
};

/** A generation owns its snapshot and at most one in-flight batch. */
export const requestState = { generation: 0, batchInFlight: false };

/** Returns whether previously hidden queue entries became eligible. */
export const updateFolderMembership = (
  feedId: string,
  folderId: string | null
): boolean => {
  const scope = activeScope();
  if (scope.kind !== 'folder') return false;

  const previous = setFolderMembership(feedId, folderId);
  if (scope.folderId !== folderId) {
    dropFeedRows(feedId);
    return false;
  }

  restoreFeedRows(feedId);
  return (
    previous !== undefined && previous !== folderId && hasQueuedFeed(feedId)
  );
};

export const groupStartIds = createMemo(() => {
  const starts = new Set<string>();
  const seen = new Set<string>();
  for (const id of records.ids) {
    const entry = snapshotPosition(id)?.entry;
    if (entry?.feedId === undefined) continue;
    if (entry.groupStart || !seen.has(entry.feedId)) starts.add(id);
    seen.add(entry.feedId);
  }
  return starts;
});

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

/**
 * Canonical records of rows dropped by a feed move, keyed by feed ID. They stay in `byId` until
 * `releaseFeedRows`, so a rollback restores list membership and order and never overwrites a read
 * state or server field that changed while the move was pending.
 */
const pinnedFeedRows = new Map<string, Array<string>>();

const evictUnused = (draft: LibraryRecords): void => {
  const keep = new Set(draft.ids);
  if (draft.retainedId !== null) keep.add(draft.retainedId);
  for (const ids of pinnedFeedRows.values()) {
    for (const id of ids) keep.add(id);
  }
  for (const id of Object.keys(draft.byId)) {
    if (!keep.has(id)) delete draft.byId[id];
  }
};

/**
 * Merges a server snapshot into the store. The read state of an article with a pending read
 * request stays at the user's latest intent, and extracted content fetched after the snapshot was
 * dispatched is kept.
 */
const mergeRecord = (
  draft: LibraryRecords,
  incoming: LibraryArticle,
  snapshotSeq?: number
): void => {
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
    if (draft.retainedId === articleId) return;
    draft.retainedId = articleId;
    evictUnused(draft);
  });
};

export const upsertArticle = (
  article: LibraryArticle,
  snapshotSeq?: number
): void => {
  setRecords((draft) => {
    mergeRecord(draft, article, snapshotSeq);
  });
};

export const clearRows = (): void => {
  pinnedFeedRows.clear();
  setRecords((draft) => {
    draft.ids.length = 0;
    evictUnused(draft);
  });
};
const sortFolderRows = (draft: LibraryRecords): void => {
  draft.ids.sort(
    (a, b) =>
      (snapshotPosition(a)?.index ?? 0) - (snapshotPosition(b)?.index ?? 0)
  );
};

/** Appends records accepted from the deduplicated queue, which excludes local prepends. */
export const appendRows = (
  items: ReadonlyArray<LibraryArticle>,
  snapshotSeq?: number
): void => {
  setRecords((draft) => {
    for (const item of items) {
      mergeRecord(draft, item, snapshotSeq);
      draft.ids.push(item.id);
    }
    if (activeScope().kind === 'folder') sortFolderRows(draft);
  });
};

export const prependRow = (article: LibraryArticle): void => {
  setRecords((draft) => {
    if (draft.ids.includes(article.id)) return;
    mergeRecord(draft, article);
    draft.ids.unshift(article.id);
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

/**
 * Removes a feed's rows from the list and returns their IDs with the previous order, for a later
 * restore. The records stay pinned until `releaseFeedRows` runs for the feed.
 */
const dropFeedRows = (feedId: string): void => {
  setRecords((draft) => {
    const ids = draft.ids.filter(
      (id) => snapshotPosition(id)?.entry.feedId === feedId
    );
    if (ids.length === 0) return;

    pinnedFeedRows.set(feedId, [...(pinnedFeedRows.get(feedId) ?? []), ...ids]);
    draft.ids = draft.ids.filter(
      (id) => snapshotPosition(id)?.entry.feedId !== feedId
    );
  });
};

/**
 * Ends a feed move's hold on its dropped records; evicts them unless the list or reader still
 * needs them.
 */
export const releaseFeedRows = (feedId: string): void => {
  if (!pinnedFeedRows.delete(feedId)) return;
  setRecords((draft) => {
    evictUnused(draft);
  });
};

/**
 * Re-adds a failed move's dropped rows at their previous positions. Only membership and order
 * return: the pinned records are still in the store, so they are never re-merged from a copy.
 */
const restoreFeedRows = (feedId: string): void => {
  const ids = pinnedFeedRows.get(feedId);
  if (ids === undefined) return;

  setRecords((draft) => {
    draft.ids = [...new Set([...draft.ids, ...ids])];
    sortFolderRows(draft);
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
  requestState.batchInFlight = false;
  pinnedFeedRows.clear();
  setRecords((draft) => {
    draft.ids.length = 0;
    draft.retainedId = null;
    evictUnused(draft);
  });
  setActiveScope({ kind: 'later' });
  setActiveUnreadOnly(false);
  resetQueue();
  setListBoundary(null);
  setLoadingInitial(false);
  setLoadingMore(false);
  setLoadError(null);
  flush();
};

onSessionCleared(clearLibraryStoreState);
