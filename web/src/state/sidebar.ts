/**
 * Sidebar state: feeds, folders, unread counts and persisted folder collapse state
 * (`LIB-COUNT-1`, `FD-FOLDER-*`, `FD-MOVE-1`).
 */

import { createSignal, flush } from 'solid-js';
import type { Feed, FeedUnreadCount, Folder } from '../api';
import { feedsApi, foldersApi, savedPagesApi } from '../api';
import { onSessionCleared } from './session';
import { getItem, setItem } from './storage';

/** `FD-FOLDER-2`: folder collapse state persists in `localStorage`. */
export const COLLAPSED_FOLDERS_STORAGE_KEY = 'reader.collapsedFolders';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'reader.sidebarCollapsed';

const [feeds, setFeeds] = createSignal<ReadonlyArray<Feed>>([]);
const [folders, setFolders] = createSignal<ReadonlyArray<Folder>>([]);
const [savedUnreadCount, setSavedUnreadSignal] = createSignal(0);
const [feedUnreadMap, setFeedUnreadMap] = createSignal<
  Readonly<Record<string, number>>
>({});
const [collapsedFolders, setCollapsedFolders] = createSignal<
  ReadonlySet<string>
>(loadCollapsed());
const [sidebarCollapsed, setSidebarCollapsed] = createSignal<boolean>(
  loadSidebarCollapsed()
);

type SnapshotField = 'feeds' | 'folders' | 'feedCounts' | 'savedCount';

const fieldEpochs: Record<SnapshotField, number> = {
  feeds: 0,
  folders: 0,
  feedCounts: 0,
  savedCount: 0,
};

let feedsLoaded = false;

interface ActiveRefresh {
  promise: Promise<void>;
  startEpochs: Record<SnapshotField, number>;
  rerunNeeded: boolean;
}

let activeRefresh: ActiveRefresh | null = null;

export {
  collapsedFolders,
  feeds,
  feedUnreadMap,
  folders,
  savedUnreadCount,
  sidebarCollapsed,
};

function loadCollapsed(): ReadonlySet<string> {
  const raw = getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
  if (raw === null) return new Set<string>();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();

    return new Set(
      parsed.filter((value): value is string => typeof value === 'string')
    );
  } catch {
    return new Set<string>();
  }
}

const applyCollapsed = (next: ReadonlySet<string>): void => {
  setCollapsedFolders(next);
  setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify([...next]));
};

function loadSidebarCollapsed(): boolean {
  return getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

export const setSidebarCollapsedState = (collapsed: boolean): void => {
  setSidebarCollapsed(collapsed);
  setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  flush();
};

export const toggleSidebarCollapse = (): void => {
  setSidebarCollapsedState(!sidebarCollapsed());
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

const captureEpochs = (): Record<SnapshotField, number> => ({ ...fieldEpochs });

const hasEpochChanged = (
  start: Readonly<Record<SnapshotField, number>>
): boolean =>
  start.feeds !== fieldEpochs.feeds ||
  start.folders !== fieldEpochs.folders ||
  start.feedCounts !== fieldEpochs.feedCounts ||
  start.savedCount !== fieldEpochs.savedCount;

const applySidebarSnapshot = (
  [
    feedsResult,
    foldersResult,
    countsResult,
    savedResult,
  ]: SidebarSnapshotResults,
  startEpochs: Readonly<Record<SnapshotField, number>>
): void => {
  if (
    feedsResult.status === 'fulfilled' &&
    startEpochs.feeds === fieldEpochs.feeds
  ) {
    feedsLoaded = true;
    setFeeds(feedsResult.value);
  }
  if (
    foldersResult.status === 'fulfilled' &&
    startEpochs.folders === fieldEpochs.folders
  ) {
    setFolders(foldersResult.value);
  }
  if (
    countsResult.status === 'fulfilled' &&
    startEpochs.feedCounts === fieldEpochs.feedCounts
  ) {
    setFeedUnreadMap(
      Object.fromEntries(
        countsResult.value.map((entry) => [entry.feedId, entry.count])
      )
    );
  }
  if (
    savedResult.status === 'fulfilled' &&
    startEpochs.savedCount === fieldEpochs.savedCount
  ) {
    setSavedUnreadSignal(Math.max(0, savedResult.value));
  }

  flush();
};

const runRefreshRound = async (owner: ActiveRefresh): Promise<void> => {
  while (activeRefresh === owner) {
    const current = activeRefresh;
    current.rerunNeeded = false;
    current.startEpochs = captureEpochs();
    const results = await Promise.allSettled([
      feedsApi.list(),
      foldersApi.list(),
      feedsApi.unreadCounts(),
      savedPagesApi.unreadCount(),
    ]);

    if (activeRefresh !== owner) return;

    applySidebarSnapshot(results, current.startEpochs);
    if (!current.rerunNeeded) return;
  }
};

const startOrJoinRefresh = (invalidate: boolean): Promise<void> => {
  if (activeRefresh !== null) {
    if (invalidate || hasEpochChanged(activeRefresh.startEpochs)) {
      activeRefresh.rerunNeeded = true;
    }

    return activeRefresh.promise;
  }

  const state: ActiveRefresh = {
    promise: Promise.resolve(),
    startEpochs: captureEpochs(),
    rerunNeeded: false,
  };
  activeRefresh = state;
  state.promise = runRefreshRound(state).finally(() => {
    if (activeRefresh === state) activeRefresh = null;
  });

  return state.promise;
};

/** `LIB-RELOAD-1`: entering/switching a scope refreshes feeds, folders and unread counts.
 * Coalesces concurrent read requests under one owner, skips fields invalidated by local mutations
 * during flight, and preserves partial-success behavior.
 */
export const refreshSidebar = (): Promise<void> => startOrJoinRefresh(false);

/** Requests a fresh sidebar snapshot after a server-side write, scheduling at most one trailing
 * round if a pre-mutation refresh is already in flight.
 */
export const invalidateSidebar = (): Promise<void> => startOrJoinRefresh(true);

/** Resolves once the feed list has been fetched (or joins any in-flight sidebar refresh). */
export const ensureFeeds = async (): Promise<void> => {
  if (activeRefresh !== null) {
    await activeRefresh.promise;

    return;
  }

  if (feedsLoaded) return;

  await refreshSidebar();
};

export const toggleFolderCollapse = (folderId: string): void => {
  const next = new Set(collapsedFolders());
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);

  applyCollapsed(next);
  flush();
};

/** Selecting a feed inside a collapsed folder auto-expands it (`FD-FOLDER-2`). */
export const expandFolder = (folderId: string): void => {
  if (!collapsedFolders().has(folderId)) return;

  const next = new Set(collapsedFolders());
  next.delete(folderId);
  applyCollapsed(next);
  flush();
};

export const adjustSavedUnread = (delta: number): void => {
  fieldEpochs.savedCount += 1;
  setSavedUnreadSignal((count) => Math.max(0, count + delta));
};

export const setSavedUnread = (count: number): void => {
  fieldEpochs.savedCount += 1;
  setSavedUnreadSignal(Math.max(0, count));
};

const updateUnreadMap = (
  update: (map: Readonly<Record<string, number>>) => Record<string, number>
) => {
  fieldEpochs.feedCounts += 1;
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
  fieldEpochs.feeds += 1;
  setFeeds((current) =>
    current.map((feed) => (feed.id === feedId ? { ...feed, ...patch } : feed))
  );
};

export const removeFeedLocal = (feedId: string): void => {
  fieldEpochs.feeds += 1;
  if (activeRefresh !== null) activeRefresh.rerunNeeded = true;

  setFeeds((current) => current.filter((feed) => feed.id !== feedId));
  clearFeedUnread(feedId);
};

/** `FD-FOLDER-4`: deleting a folder keeps its feeds and moves them to the top level. */
export const removeFolderLocal = (folderId: string): void => {
  fieldEpochs.folders += 1;
  fieldEpochs.feeds += 1;
  if (activeRefresh !== null) activeRefresh.rerunNeeded = true;

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

export const clearSidebarState = (): void => {
  fieldEpochs.feeds += 1;
  fieldEpochs.folders += 1;
  fieldEpochs.feedCounts += 1;
  fieldEpochs.savedCount += 1;
  feedsLoaded = false;
  activeRefresh = null;
  setFeeds([]);
  setFolders([]);
  setSavedUnreadSignal(0);
  setFeedUnreadMap({});
  flush();
};

onSessionCleared(clearSidebarState);
