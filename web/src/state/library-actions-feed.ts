/**
 * Feed-level library actions: moving a feed between folders and storing its reader preferences
 * (`FD-MOVE-1`, `FD-PREF-1`, `RD-MODE-1`). A rollback never touches rows owned by a newer scope
 * generation (`LIB-RELOAD-1`).
 */

import { flush } from 'solid-js';
import type { Feed } from '../api';
import { ApiError, feedsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import type { LibraryArticle } from './library-store';
import { activeScope, requestState, rows, setRows } from './library-store';
import * as sidebar from './sidebar';

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

const dropFeedRows = (feedId: string): void => {
  setRows((rowsNow) =>
    rowsNow.filter((row) => !(row.kind === 'feed' && row.feedId === feedId))
  );
};

/** Re-inserts `removed` rows (skipping ids already present) using the previous list order. */
const mergeRows = (
  current: ReadonlyArray<LibraryArticle>,
  removed: ReadonlyArray<LibraryArticle>,
  previousOrder: ReadonlyArray<LibraryArticle>
): ReadonlyArray<LibraryArticle> => {
  const present = new Set(current.map((row) => row.id));
  const missing = removed.filter((row) => !present.has(row.id));
  if (missing.length === 0) return current;

  const positions = new Map(previousOrder.map((row, index) => [row.id, index]));
  return [...current, ...missing].sort(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
};

/**
 * `FD-MOVE-1`: moves a feed without reloading the list; leaving the open folder scope drops that
 * feed's rows.
 */
export const moveFeedToFolder = async (
  feed: Feed,
  folderId: string | null
): Promise<boolean> => {
  const startGeneration = requestState.generation;
  const previousFolderId = feed.folderId ?? null;
  const scope = activeScope();
  const leavesOpenFolder =
    scope.kind === 'folder' && scope.folderId !== folderId;
  const previousRows = rows();
  const removedRows = previousRows.filter(
    (row) => row.kind === 'feed' && row.feedId === feed.id
  );

  sidebar.updateFeedLocal(feed.id, { folderId });
  if (leavesOpenFolder) dropFeedRows(feed.id);
  flush();

  try {
    await feedsApi.moveToFolder(feed.id, folderId);
    showToast(String(t('folders.movedToast')), 'success');
    return true;
  } catch (error) {
    sidebar.updateFeedLocal(feed.id, { folderId: previousFolderId });
    // Restore only the dropped rows, and only while the same scope generation owns the list.
    if (leavesOpenFolder && requestState.generation === startGeneration) {
      setRows((rowsNow) => mergeRows(rowsNow, removedRows, previousRows));
      flush();
    }
    showToast(translateErrorCode(codeOf(error)), 'error');
    return false;
  }
};

/** `FD-PREF-1`: stores the feed's starting reader mode (`RD-MODE-1`). */
export const changeFeedReaderMode = async (
  feed: Feed,
  readerMode: Feed['readerMode']
): Promise<boolean> => {
  try {
    await feedsApi.setReaderMode(feed.id, readerMode);
  } catch (error) {
    showToast(translateErrorCode(codeOf(error)), 'error');
    return false;
  }

  sidebar.updateFeedLocal(feed.id, { readerMode });

  return true;
};
