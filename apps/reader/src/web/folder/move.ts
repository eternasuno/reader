import { createSignal } from 'solid-js';
import { moveFeed } from '../api/feed';
import { messageOf } from '../api/messages';
import { type Feed, loadSidebar } from '../feed';
import { showToast } from '../ui/toast';

const movedMessage = '已移动';

const [moving, setMoving] = createSignal<Feed>();
const [target, setTarget] = createSignal<string>();

/** The feed the move dialog is open for; undefined when it is closed. */
export const movingFeed = (): Feed | undefined => moving();

/** The chosen folder; undefined is `不放入目录`, the top level. */
export const moveTarget = (): string | undefined => target();

export const setMoveTarget = (folderId: string | undefined): void => {
  setTarget(folderId);
};

/** Opens the dialog with the feed's current folder preselected (folders.md). */
export const openMoveFeed = (feed: Feed): void => {
  setTarget(feed.folderId);
  setMoving(feed);
};

export const closeMoveFeed = (): void => {
  setMoving(undefined);
};

/**
 * Moves the feed (FD-MOVE). Moving is a quick action (Client conventions): the
 * dialog keeps no pending state and every submit sends the selected target,
 * the feed's current folder included, which the server answers without a change
 * (FD-MOVE-1). On success the dialog closes, the toast says `已移动` and the
 * sidebar lists feeds and folders again to place the row; the article list
 * stays as it is. On failure the dialog stays open and the feed stays where it
 * was.
 */
export const moveFeedToFolder = async (): Promise<void> => {
  const feed = moving();

  if (feed === undefined) return;

  try {
    await moveFeed(feed.id, target() ?? null);
    setMoving(undefined);
    showToast(movedMessage);
    await loadSidebar();
  } catch (error) {
    showToast(messageOf(error), 'error');
  }
};
