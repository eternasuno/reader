/**
 * Sidebar state: feeds, folders, unread counts and persisted folder collapse state
 * (`LIB-COUNT-1`, `FD-FOLDER-*`, `FD-MOVE-1`).
 */

import { createSignal, flush } from 'solid-js';
import type { Feed, FeedUnreadCount, Folder } from '../api';
import { feedsApi, foldersApi, savedPagesApi } from '../api';

/** `folders.md:16`: folder collapse state persists in `localStorage`. */
export const COLLAPSED_FOLDERS_STORAGE_KEY = 'reader.collapsedFolders';

const [feeds, setFeeds] = createSignal<ReadonlyArray<Feed>>([]);
const [folders, setFolders] = createSignal<ReadonlyArray<Folder>>([]);
const [savedUnreadCount, setSavedUnreadSignal] = createSignal(0);
const [feedUnreadMap, setFeedUnreadMap] = createSignal<
  Readonly<Record<string, number>>
>({});
const [collapsedFolders, setCollapsedFolders] = createSignal<
  ReadonlySet<string>
>(loadCollapsed());
let snapshotGeneration = 0;

export { collapsedFolders, feeds, feedUnreadMap, folders, savedUnreadCount };

function loadCollapsed(): ReadonlySet<string> {
  if (typeof localStorage === 'undefined') return new Set<string>();

  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
    if (raw === null) return new Set<string>();

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();

    return new Set(
      parsed.filter((value): value is string => typeof value === 'string')
    );
  } catch {
    return new Set<string>();
  }
}

const persistCollapsed = (next: ReadonlySet<string>): void => {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(
      COLLAPSED_FOLDERS_STORAGE_KEY,
      JSON.stringify([...next])
    );
  } catch {
    // Storage may be unavailable (private mode / quota); collapse state then stays in memory.
  }
};

const applyCollapsed = (next: ReadonlySet<string>): void => {
  setCollapsedFolders(next);
  persistCollapsed(next);
};

// Derived helpers stay plain accessors: they read the reactive signals and are recomputed only
// when a consumer (JSX or a memo) reads them.

export const feedUnreadCount = (feedId: string): number =>
  feedUnreadMap()[feedId] ?? 0;

export const folderFeeds = (folderId: string): ReadonlyArray<Feed> =>
  feeds().filter((feed) => feed.folderId === folderId);

export const topLevelFeeds = (): ReadonlyArray<Feed> =>
  feeds().filter((feed) => !feed.folderId);

/** `LIB-COUNT-1`: a folder's unread count is the sum of its feeds' counts. */
export const folderUnreadCount = (folderId: string): number =>
  folderFeeds(folderId).reduce(
    (sum, feed) => sum + feedUnreadCount(feed.id),
    0
  );

/** `LIB-COUNT-1`: the `All feeds` scope shows the sum of every feed's unread count. */
export const allFeedsUnreadCount = (): number =>
  feeds().reduce((sum, feed) => sum + feedUnreadCount(feed.id), 0);

type SidebarSnapshotResults = [
  PromiseSettledResult<Array<Feed>>,
  PromiseSettledResult<Array<Folder>>,
  PromiseSettledResult<Array<FeedUnreadCount>>,
  PromiseSettledResult<number>,
];

const applySidebarSnapshot = ([
  feedsResult,
  foldersResult,
  countsResult,
  savedResult,
]: SidebarSnapshotResults): void => {
  if (feedsResult.status === 'fulfilled') setFeeds(feedsResult.value);
  if (foldersResult.status === 'fulfilled') setFolders(foldersResult.value);
  if (countsResult.status === 'fulfilled') {
    setFeedUnreadMap(
      Object.fromEntries(
        countsResult.value.map((entry) => [entry.feedId, entry.count])
      )
    );
  }
  if (savedResult.status === 'fulfilled')
    setSavedUnreadSignal(Math.max(0, savedResult.value));

  flush();
};

/** `LIB-RELOAD-1`: entering/switching a scope refreshes feeds, folders and unread counts. The
 * sidebar is auxiliary, so a failed request keeps the previous value instead of breaking the list.
 * Local feed/folder removals invalidate in-flight snapshots so a racing refresh re-fetches.
 */
export const refreshSidebar = async (): Promise<void> => {
  const generation = snapshotGeneration;
  const results = await Promise.allSettled([
    feedsApi.list(),
    foldersApi.list(),
    feedsApi.unreadCounts(),
    savedPagesApi.unreadCount(),
  ]);

  if (generation !== snapshotGeneration) return refreshSidebar();

  applySidebarSnapshot(results);
};

export const toggleFolderCollapse = (folderId: string): void => {
  const next = new Set(collapsedFolders());
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);

  applyCollapsed(next);
  flush();
};

/** Selecting a feed inside a collapsed folder auto-expands it (`folders.md:16`). */
export const expandFolder = (folderId: string): void => {
  if (!collapsedFolders().has(folderId)) return;

  const next = new Set(collapsedFolders());
  next.delete(folderId);
  applyCollapsed(next);
  flush();
};

export const adjustSavedUnread = (delta: number): void => {
  setSavedUnreadSignal((count) => Math.max(0, count + delta));
};

export const setSavedUnread = (count: number): void => {
  setSavedUnreadSignal(Math.max(0, count));
};

const updateUnreadMap = (
  update: (map: Readonly<Record<string, number>>) => Record<string, number>
) => {
  setFeedUnreadMap((map) => update(map));
};

export const adjustFeedUnread = (feedId: string, delta: number): void => {
  updateUnreadMap((map) => {
    const next = Math.max(0, (map[feedId] ?? 0) + delta);
    const copy = { ...map };
    if (next === 0) delete copy[feedId];
    else copy[feedId] = next;
    return copy;
  });
};

export const clearFeedUnread = (feedId: string): void => {
  updateUnreadMap((map) => {
    if (!(feedId in map)) return { ...map };
    const copy = { ...map };
    delete copy[feedId];
    return copy;
  });
};

export const clearFolderUnread = (folderId: string): void => {
  const feedIds = new Set(folderFeeds(folderId).map((feed) => feed.id));
  updateUnreadMap((map) =>
    Object.fromEntries(
      Object.entries(map).filter(([feedId]) => !feedIds.has(feedId))
    )
  );
};

export const clearAllFeedsUnread = (): void => {
  updateUnreadMap(() => ({}));
};

export const updateFeedLocal = (feedId: string, patch: Partial<Feed>): void => {
  setFeeds((current) =>
    current.map((feed) => (feed.id === feedId ? { ...feed, ...patch } : feed))
  );
};

export const removeFeedLocal = (feedId: string): void => {
  snapshotGeneration += 1;
  setFeeds((current) => current.filter((feed) => feed.id !== feedId));
  clearFeedUnread(feedId);
};

/** `FD-FOLDER-4`: deleting a folder keeps its feeds and moves them to the top level. */
export const removeFolderLocal = (folderId: string): void => {
  snapshotGeneration += 1;
  setFolders((current) => current.filter((folder) => folder.id !== folderId));
  setFeeds((current) =>
    current.map((feed) =>
      feed.folderId === folderId ? { ...feed, folderId: null } : feed
    )
  );
  if (collapsedFolders().has(folderId)) {
    const next = new Set(collapsedFolders());
    next.delete(folderId);
    applyCollapsed(next);
  }
};
