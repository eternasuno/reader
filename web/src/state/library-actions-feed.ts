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
import { feedMoveTracker, LatestTokenMap } from './library-mutations';
import { trimRecordCache, updateFolderMembership } from './library-store';
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

const reconcileFeedMove = (
  feedId: string,
  targetFolderId: string | null
): void => {
  const current = currentFolderOfId(feedId);
  if (current !== undefined && current !== targetFolderId) {
    sidebar.updateFeedLocal(feedId, { folderId: targetFolderId });
  }
  updateFolderMembership(feedId, targetFolderId);
  flush();
};

const runFeedMove = async (
  feed: Feed,
  folderId: string | null
): Promise<boolean> => {
  const token = feedMoveTracker.begin(feed.id, currentFolderOf(feed), folderId);
  updateFolderMembership(feed.id, folderId);
  sidebar.updateFeedLocal(feed.id, { folderId });
  flush();

  try {
    await feedsApi.moveToFolder(feed.id, folderId);
    const outcome = feedMoveTracker.succeed(feed.id, token, folderId);
    if (outcome !== null) {
      reconcileFeedMove(feed.id, outcome.targetFolderId);
      if (outcome.owns) {
        showToast(t('folders.movedToast'), 'success');
      }
    }
    return true;
  } catch (error) {
    const outcome = feedMoveTracker.fail(feed.id, token);
    if (outcome === null) return false;

    reconcileFeedMove(feed.id, outcome.targetFolderId);
    if (outcome.owns) {
      showToast(errorText(error), 'error');
    }
    return false;
  }
};

/**
 * `FD-MOVE-1`: moves a feed without reloading the list; leaving the open folder scope drops that
 * feed's rows. Those rows stay pinned until the feed's last move settles.
 */
export const moveFeedToFolder = async (
  feed: Feed,
  folderId: string | null
): Promise<boolean> => {
  try {
    return await runFeedMove(feed, folderId);
  } finally {
    trimRecordCache();
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
