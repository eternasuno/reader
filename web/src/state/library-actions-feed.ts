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
import { changeRows } from './library-motion';
import { feedMoveTracker, LatestTokenMap } from './library-mutations';
import { invalidateLiveSnapshot } from './library-snapshot';
import {
  folderMoveChangesRows,
  trimRecordCache,
  updateFolderMembership,
} from './library-store';
import { onSessionCleared, sessionGeneration } from './session';
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

/**
 * The folder the open list should show for `feedId` when a deferred transition update runs: the
 * latest pending move, which may have started after the update was scheduled; otherwise the
 * sidebar's folder, which every move and settlement updates synchronously (a newer move may
 * already have settled); `fallback` only for a feed missing from the sidebar.
 */
const listedFolderOf = (
  feedId: string,
  fallback: string | null
): string | null => {
  const pending = feedMoveTracker
    .pendingFolders()
    .find(([pendingFeedId]) => pendingFeedId === feedId);
  if (pending !== undefined) return pending[1];

  const current = currentFolderOfId(feedId);
  return current === undefined ? fallback : current;
};

/**
 * Shows a feed's folder membership in the open list inside a list transition. The sidebar, which
 * newer moves read as their baseline, is updated synchronously by the callers.
 */
const showFolderMembership = (
  feedId: string,
  folderId: string | null,
  afterUpdate: (membershipChanged: boolean) => void = () => undefined
): Promise<void> => {
  const session = sessionGeneration();
  return changeRows(folderMoveChangesRows(feedId, folderId), () => {
    if (sessionGeneration() !== session) return;

    afterUpdate(
      updateFolderMembership(feedId, listedFolderOf(feedId, folderId))
    );
    flush();
  });
};

const reconcileFeedMove = (
  feedId: string,
  targetFolderId: string | null
): Promise<void> => {
  const current = currentFolderOfId(feedId);
  if (current !== undefined && current !== targetFolderId) {
    sidebar.updateFeedLocal(feedId, { folderId: targetFolderId });
    flush();
  }

  return showFolderMembership(feedId, targetFolderId, (membershipChanged) => {
    if (!membershipChanged && !feedMoveTracker.hasPendingMove(feedId)) {
      invalidateLiveSnapshot();
    }
  });
};

const requestFeedMove = async (
  feedId: string,
  folderId: string | null
): Promise<{ error: unknown } | null> => {
  try {
    await feedsApi.moveToFolder(feedId, folderId);
    return null;
  } catch (error) {
    return { error };
  }
};

const runFeedMove = async (
  feed: Feed,
  folderId: string | null
): Promise<boolean> => {
  const token = feedMoveTracker.begin(feed.id, currentFolderOf(feed), folderId);
  sidebar.updateFeedLocal(feed.id, { folderId });
  flush();
  const shown = showFolderMembership(feed.id, folderId);
  const failure = await requestFeedMove(feed.id, folderId);
  // Settle only after the optimistic change is on screen, so it never overwrites a rollback.
  await shown;

  if (failure === null) {
    const outcome = feedMoveTracker.succeed(feed.id, token, folderId);
    if (outcome !== null) {
      await reconcileFeedMove(feed.id, outcome.targetFolderId);
      if (outcome.owns) showToast(t('folders.movedToast'), 'success');
    }
    return true;
  }

  const outcome = feedMoveTracker.fail(feed.id, token);
  if (outcome === null) return false;

  await reconcileFeedMove(feed.id, outcome.targetFolderId);
  if (outcome.owns) showToast(errorText(failure.error), 'error');
  return false;
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
