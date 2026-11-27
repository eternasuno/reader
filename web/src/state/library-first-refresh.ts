/**
 * `FD-SUB-2` helpers: wait for a new feed's first background refresh. The wait does not hook list
 * loads; each tick checks whether a library page is mounted and which scope it shows.
 */

import type { Feed } from '../api';
import { feedsApi } from '../api';
import { activeScope, isLibraryMounted, rowIds } from './library-store';

const INITIAL_REFRESH_POLL_MS = 2000;
const INITIAL_REFRESH_POLL_ATTEMPTS = 15;

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();

    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });

const hasFinishedFirstRefresh = (feed: Feed): boolean =>
  feed.updatedAt !== undefined || feed.failureCount > 0;

/** `true`/`false` = refreshed or not yet (a failed request retries); `null` = feed is gone. */
const pollFeedStatus = async (feedId: string): Promise<boolean | null> => {
  try {
    const feed = (await feedsApi.list()).find((entry) => entry.id === feedId);

    return feed === undefined ? null : hasFinishedFirstRefresh(feed);
  } catch {
    return false;
  }
};

const isViewingFeed = (feedId: string): boolean => {
  const scope = activeScope();

  return isLibraryMounted() && scope.kind === 'feed' && scope.feedId === feedId;
};

export const isShowingEmptyFeed = (feedId: string): boolean =>
  isViewingFeed(feedId) && rowIds().length === 0;

type TickAction = 'poll' | 'skip' | 'stop';

/**
 * Before the new feed is first shown, ticks are skipped (navigation may still be loading it);
 * once it was shown, leaving it, unmounting the library, or rows arriving ends the wait.
 */
const tickAction = (feedId: string, reached: boolean): TickAction => {
  if (!isLibraryMounted()) return 'stop';
  if (!isViewingFeed(feedId)) return reached ? 'stop' : 'skip';

  return rowIds().length === 0 ? 'poll' : 'stop';
};

const pollOutcome = async (
  feedId: string,
  signal: AbortSignal
): Promise<'ready' | 'retry' | 'stop'> => {
  const ready = await pollFeedStatus(feedId);
  if (signal.aborted || ready === null) return 'stop';

  return ready ? 'ready' : 'retry';
};

/** Resolves `true` once the feed's first refresh finished while its empty list is still shown. */
export const waitForFirstRefresh = async (
  feedId: string,
  signal: AbortSignal
): Promise<boolean> => {
  let reached = false;
  for (let attempt = 0; attempt < INITIAL_REFRESH_POLL_ATTEMPTS; attempt += 1) {
    await wait(INITIAL_REFRESH_POLL_MS, signal);
    if (signal.aborted) return false;

    const action = tickAction(feedId, reached);
    if (action === 'stop') return false;
    if (action === 'skip') continue;

    reached = true;
    const outcome = await pollOutcome(feedId, signal);
    if (outcome !== 'retry') return outcome === 'ready';
  }

  return false;
};
