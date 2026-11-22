/**
 * Library row actions: optimistic read state, mark-all, feed moves and feed preferences
 * (`LIB-READ-1..2`, `FD-MOVE-1`, `FD-PREF-1`). Every action rolls back on failure, and a rollback
 * never touches rows owned by a newer scope generation (`LIB-RELOAD-1`).
 */

import { flush } from 'solid-js';
import {
  ApiError,
  feedItemsApi,
  feedsApi,
  foldersApi,
  savedPagesApi,
} from '../api';
import { translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import type { ArticleReadFallback, LibraryArticle } from './library-store';
import {
  activeScope,
  notifyArticlePatched,
  requestState,
  rows,
  setRows,
} from './library-store';
import type { LibraryScope } from './scope';
import * as sidebar from './sidebar';

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

const findRow = (articleId: string): LibraryArticle | null =>
  rows().find((candidate) => candidate.id === articleId) ?? null;

const setRowRead = (articleId: string, read: boolean): void => {
  setRows((current) =>
    current.map((candidate) =>
      candidate.id === articleId
        ? ({ ...candidate, read } as LibraryArticle)
        : candidate
    )
  );
};

const adjustUnread = (
  kind: LibraryArticle['kind'],
  feedId: string | null,
  delta: number
): void => {
  if (kind === 'later') {
    sidebar.adjustSavedUnread(delta);
    return;
  }

  if (feedId !== null) sidebar.adjustFeedUnread(feedId, delta);
};

const rowKindOf = (
  row: LibraryArticle | null,
  fallback: ArticleReadFallback | undefined
): LibraryArticle['kind'] => {
  if (row !== null) return row.kind;
  if (fallback !== undefined) return fallback.kind;

  return activeScope().kind === 'later' ? 'later' : 'feed';
};

const rowFeedIdOf = (
  row: LibraryArticle | null,
  fallback: ArticleReadFallback | undefined
): string | null => {
  if (row !== null) return row.kind === 'feed' ? row.feedId : null;
  if (fallback === undefined || fallback.kind !== 'feed') return null;

  return fallback.feedId ?? null;
};

const setReadRequest = async (
  kind: LibraryArticle['kind'],
  articleId: string,
  read: boolean
): Promise<void> => {
  if (kind === 'later') {
    await savedPagesApi.setRead(articleId, read);
    return;
  }

  await feedItemsApi.setRead(articleId, read);
};

const applyReadChange = (
  articleId: string,
  read: boolean,
  kind: LibraryArticle['kind'],
  feedId: string | null,
  hasRow: boolean
): void => {
  if (hasRow) setRowRead(articleId, read);
  adjustUnread(kind, feedId, read ? -1 : 1);
  notifyArticlePatched(articleId, { read });
  flush();
};

const rollbackRead = (
  articleId: string,
  previousRead: boolean,
  canPatchRow: boolean
): void => {
  if (canPatchRow) setRowRead(articleId, previousRead);
  notifyArticlePatched(articleId, { read: previousRead });
  flush();
};

const handleReadFailure = async (
  error: unknown,
  articleId: string,
  previousRead: boolean | undefined,
  canPatchRow: boolean
): Promise<void> => {
  if (previousRead !== undefined) {
    rollbackRead(articleId, previousRead, canPatchRow);
  }
  await sidebar.refreshSidebar();
  showToast(translateErrorCode(codeOf(error)), 'error');
};

/**
 * `LIB-FILTER-1` / `LIB-READ-1`: flips read state optimistically. Rows never leave the loaded list,
 * and the action is never gated by in-flight flags. `fallback` carries the context of an article
 * that is open but not part of the loaded rows (a deep link).
 */
export const toggleArticleRead = async (
  articleId: string,
  nextRead: boolean,
  fallback?: ArticleReadFallback
): Promise<boolean> => {
  const row = findRow(articleId);
  if (row !== null && row.read === nextRead) return true;
  if (row === null && fallback !== undefined && fallback.read === nextRead) {
    return true;
  }

  const kind = rowKindOf(row, fallback);
  const feedId = rowFeedIdOf(row, fallback);
  const previousRead = row !== null ? row.read : fallback?.read;
  const startGeneration = requestState.generation;
  const hasRow = row !== null;

  if (previousRead !== undefined) {
    applyReadChange(articleId, nextRead, kind, feedId, hasRow);
  }

  try {
    await setReadRequest(kind, articleId, nextRead);
    return true;
  } catch (error) {
    // `LIB-RELOAD-1`: a rollback must never overwrite rows loaded by a newer scope.
    const ownsRows = hasRow && requestState.generation === startGeneration;
    await handleReadFailure(error, articleId, previousRead, ownsRows);
    return false;
  }
};

interface UnreadSplit {
  unread: ReadonlyArray<LibraryArticle>;
  savedIds: Array<string>;
  feedItemIds: Array<string>;
  feedCounts: Map<string, number>;
}

const countByFeed = (
  feedRows: ReadonlyArray<LibraryArticle>
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const row of feedRows) {
    if (row.kind !== 'feed') continue;
    counts.set(row.feedId, (counts.get(row.feedId) ?? 0) + 1);
  }

  return counts;
};

const splitUnreadRows = (
  currentRows: ReadonlyArray<LibraryArticle>
): UnreadSplit => {
  const unread = currentRows.filter((row) => !row.read);
  const feedRows = unread.filter((row) => row.kind === 'feed');

  return {
    unread,
    savedIds: unread.filter((row) => row.kind === 'later').map((row) => row.id),
    feedItemIds: feedRows.map((row) => row.id),
    feedCounts: countByFeed(feedRows),
  };
};

const markRowsRead = (
  shouldMark: (row: LibraryArticle) => boolean,
  read: boolean
): void => {
  setRows((current) =>
    current.map((row) =>
      row.read === read || !shouldMark(row)
        ? row
        : ({ ...row, read } as LibraryArticle)
    )
  );
};

const revertRowsRead = (
  revertedIds: ReadonlySet<string>,
  rowsBefore: ReadonlyArray<LibraryArticle>
): void => {
  markRowsRead((row) => revertedIds.has(row.id), false);
  for (const row of rowsBefore)
    notifyArticlePatched(row.id, { read: row.read });
  flush();
};

const markIdsReadRequest = async (split: UnreadSplit): Promise<void> => {
  await Promise.all([
    split.savedIds.length > 0
      ? savedPagesApi.markIdsRead(split.savedIds)
      : Promise.resolve(),
    split.feedItemIds.length > 0
      ? feedItemsApi.markIdsRead(split.feedItemIds)
      : Promise.resolve(),
  ]);
};

const applyUnreadDecrements = (split: UnreadSplit): void => {
  if (split.savedIds.length > 0)
    sidebar.adjustSavedUnread(-split.savedIds.length);
  for (const [feedId, count] of split.feedCounts) {
    sidebar.adjustFeedUnread(feedId, -count);
  }
};

/** `LIB-READ-2`: marks every loaded unread row read in one batch per content kind. */
export const markLoadedRead = async (): Promise<void> => {
  const startGeneration = requestState.generation;
  const split = splitUnreadRows(rows());
  if (split.unread.length === 0) return;

  markRowsRead((row) => !row.read, true);
  applyUnreadDecrements(split);
  for (const row of split.unread) notifyArticlePatched(row.id, { read: true });
  flush();

  try {
    await markIdsReadRequest(split);
  } catch (error) {
    // Roll back only the affected rows, and only while this scope generation still owns them.
    if (requestState.generation === startGeneration) {
      revertRowsRead(new Set(split.unread.map((row) => row.id)), split.unread);
    }
    await sidebar.refreshSidebar();
    showToast(translateErrorCode(codeOf(error)), 'error');
  }
};

const scopeMatchesRow = (scope: LibraryScope, row: LibraryArticle): boolean => {
  switch (scope.kind) {
    case 'later':
      return row.kind === 'later';
    case 'all':
      return row.kind === 'feed';
    case 'feed':
      return row.kind === 'feed' && row.feedId === scope.feedId;
    case 'folder':
      return (
        row.kind === 'feed' &&
        sidebar
          .folderFeeds(scope.folderId)
          .some((feed) => feed.id === row.feedId)
      );
  }
};

const clearScopeUnread = (scope: LibraryScope): void => {
  switch (scope.kind) {
    case 'later':
      sidebar.setSavedUnread(0);
      break;
    case 'all':
      sidebar.clearAllFeedsUnread();
      break;
    case 'feed':
      sidebar.clearFeedUnread(scope.feedId);
      break;
    case 'folder':
      sidebar.clearFolderUnread(scope.folderId);
      break;
  }
};

const markScopeReadRequest = async (scope: LibraryScope): Promise<void> => {
  switch (scope.kind) {
    case 'later':
      await savedPagesApi.markAllRead();
      break;
    case 'all':
      await feedItemsApi.markAllRead();
      break;
    case 'feed':
      await feedsApi.markAllRead(scope.feedId);
      break;
    case 'folder':
      await foldersApi.markAllRead(scope.folderId);
      break;
  }
};

/** `LIB-READ-2`: scope-wide mark-all through the scope's own endpoint. */
export const markScopeAllRead = async (
  targetScope?: LibraryScope
): Promise<void> => {
  const startGeneration = requestState.generation;
  const scope = targetScope ?? activeScope();
  const shouldMark = (row: LibraryArticle): boolean =>
    !row.read && scopeMatchesRow(scope, row);
  const markedRows = rows().filter(shouldMark);
  const revertedIds = new Set(markedRows.map((row) => row.id));

  markRowsRead(shouldMark, true);
  clearScopeUnread(scope);
  for (const row of markedRows) notifyArticlePatched(row.id, { read: true });
  flush();

  try {
    await markScopeReadRequest(scope);
  } catch (error) {
    // Never let a late failure clobber rows loaded by a newer scope.
    if (requestState.generation === startGeneration) {
      revertRowsRead(revertedIds, markedRows);
    }
    await sidebar.refreshSidebar();
    showToast(translateErrorCode(codeOf(error)), 'error');
  }
};
