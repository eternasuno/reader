import { createSignal } from 'solid-js';
import { getFeedUnreadCounts } from '../api/feed';
import { feeds } from './list';

/** The unread count of every feed; a feed that is absent counts as 0 (FD-COUNT-1). */
export type CountsSnapshot = ReadonlyMap<string, number>;

const [counts, setCounts] = createSignal<CountsSnapshot>(new Map());

/** A copy with one feed's count set; zero is stored as absent. */
const withCount = (
  snapshot: CountsSnapshot,
  feedId: string,
  count: number
): CountsSnapshot => {
  const next = new Map(snapshot);

  if (count === 0) next.delete(feedId);
  else next.set(feedId, count);

  return next;
};

export const feedUnreadCount = (feedId: string): number =>
  counts().get(feedId) ?? 0;

/** The total is the sum over the feeds (FD-COUNT-2). */
export const allUnreadCount = (): number => {
  let total = 0;

  for (const count of counts().values()) total += count;

  return total;
};

/** A folder's count is the sum over the feeds that are in it (FD-COUNT-3). */
export const folderUnreadCount = (folderId: string): number =>
  feeds().reduce(
    (sum, feed) =>
      feed.folderId === folderId ? sum + feedUnreadCount(feed.id) : sum,
    0
  );

/** Moves one feed's count by `delta`, never below zero (LIB-COUNT-2). */
export const adjustFeedUnread = (feedId: string, delta: number): void => {
  setCounts((current) =>
    withCount(current, feedId, Math.max(0, feedUnreadCount(feedId) + delta))
  );
};

/** The counts as they are now, for a rollback (LIB-READ-6). */
export const countsSnapshot = (): CountsSnapshot => new Map(counts());

export const restoreCounts = (snapshot: CountsSnapshot): void => {
  setCounts(new Map(snapshot));
};

/** Sets the counts of the given feeds to zero (LIB-READ-4/5). */
export const clearUnread = (feedIds: ReadonlyArray<string>): void => {
  setCounts((current) => {
    const next = new Map(current);

    for (const feedId of feedIds) next.delete(feedId);

    return next;
  });
};

/**
 * Reads every count again. A failure keeps the last known counts and reports
 * nothing here: count reads follow a mark, whose own outcome is what is shown
 * (LIB-COUNT-2).
 */
export const reloadCounts = async (): Promise<void> => {
  try {
    await loadCounts();
  } catch {
    // The last known counts stay: LIB-COUNT-2.
  }
};

/** The throwing loader: `loadSidebar` needs to know that it failed (library.md API). */
export const loadCounts = async (): Promise<void> => {
  const { items } = await getFeedUnreadCounts();

  setCounts(new Map(items.map((item) => [item.feedId, item.count])));
};
