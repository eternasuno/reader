/**
 * Feed-level library actions: moving a feed between folders and storing its reader preferences
 * (`FD-MOVE-1`, `FD-PREF-1`, `RD-MODE-1`). Overlapping moves track per-feed desired state so a
 * late failure never undoes a newer choice.
 */

import { flush } from 'solid-js';
import type { Feed } from '../api';
import { feedsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { DroppedFeedRows } from './library-mutations';
import { feedMoveTracker, LatestTokenMap } from './library-mutations';
import {
  activeScope,
  dropFeedRows,
  requestState,
  restoreFeedRows,
  rowIds,
  rows,
} from './library-store';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

const readerModeTokens = new LatestTokenMap();

const currentFolderOf = (feed: Feed): string | null => {
  const stored = sidebar.feeds().find((entry) => entry.id === feed.id);
  return stored !== undefined
    ? (stored.folderId ?? null)
    : (feed.folderId ?? null);
};

const currentFolderOfId = (feedId: string): string | null | undefined => {
  const stored = sidebar.feeds().find((entry) => entry.id === feedId);
  return stored !== undefined ? (stored.folderId ?? null) : undefined;
};

const maybeRestoreDropped = (
  dropped: DroppedFeedRows | null,
  targetFolderId: string | null
): void => {
  if (
    dropped !== null &&
    targetFolderId === dropped.folderId &&
    requestState.generation === dropped.scopeGeneration
  ) {
    restoreFeedRows(dropped.rows, dropped.orderIds);
  }
};

const reconcileFeedMove = (
  feedId: string,
  targetFolderId: string | null,
  dropped: DroppedFeedRows | null
): void => {
  const current = currentFolderOfId(feedId);
  if (current !== undefined && current !== targetFolderId) {
    sidebar.updateFeedLocal(feedId, { folderId: targetFolderId });
  }
  maybeRestoreDropped(dropped, targetFolderId);
  flush();
};

/**
 * `FD-MOVE-1`: moves a feed without reloading the list; leaving the open folder scope drops that
 * feed's rows.
 */
export const moveFeedToFolder = async (
  feed: Feed,
  folderId: string | null
): Promise<boolean> => {
  const token = feedMoveTracker.begin(feed.id, currentFolderOf(feed), folderId);
  const scope = activeScope();

  if (scope.kind === 'folder' && scope.folderId !== folderId) {
    const orderIds = rowIds();
    const removedRows = rows().filter(
      (row) => row.kind === 'feed' && row.feedId === feed.id
    );
    feedMoveTracker.recordDrop(feed.id, {
      scopeGeneration: requestState.generation,
      folderId: scope.folderId,
      rows: removedRows,
      orderIds,
    });
    dropFeedRows(feed.id);
  }

  sidebar.updateFeedLocal(feed.id, { folderId });
  flush();

  try {
    await feedsApi.moveToFolder(feed.id, folderId);
    const outcome = feedMoveTracker.succeed(feed.id, token, folderId);
    if (outcome !== null) {
      reconcileFeedMove(feed.id, outcome.targetFolderId, outcome.dropped);
      if (outcome.owns) {
        showToast(t('folders.movedToast'), 'success');
      }
    }
    return true;
  } catch (error) {
    const outcome = feedMoveTracker.fail(feed.id, token);
    if (outcome === null) return false;

    reconcileFeedMove(feed.id, outcome.targetFolderId, outcome.dropped);
    if (outcome.owns) {
      showToast(errorText(error), 'error');
    }
    return false;
  }
};

/** `FD-PREF-1`: stores the feed's starting reader mode (`RD-MODE-1`). */
export const changeFeedReaderMode = async (
  feed: Feed,
  readerMode: Feed['readerMode']
): Promise<boolean> => {
  const token = readerModeTokens.claim(feed.id);
  try {
    await feedsApi.setReaderMode(feed.id, readerMode);
    if (readerModeTokens.isCurrent(feed.id, token)) {
      sidebar.updateFeedLocal(feed.id, { readerMode });
    }
    return true;
  } catch (error) {
    if (readerModeTokens.isCurrent(feed.id, token)) {
      showToast(errorText(error), 'error');
    }
    return false;
  } finally {
    readerModeTokens.release(feed.id, token);
  }
};

onSessionCleared(() => {
  readerModeTokens.reset();
});
