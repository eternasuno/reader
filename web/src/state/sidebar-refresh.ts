/**
 * Sidebar refresh owner (`LIB-RELOAD-1`), queue-aware count gating, drain sync,
 * 60 s periodic polling, and visibility recovery.
 */

import type { Feed, Folder, SavedPageUnreadCount, UnreadCounts } from '../api';
import { feedsApi, foldersApi, savedPagesApi } from '../api';
import { onQueueDrained, queueEpoch, queueIdle } from './read-sync';
import { onSessionCleared } from './session';

const SIDEBAR_REFRESH_INTERVAL_MS = 60_000;

export type SnapshotField = 'feeds' | 'folders' | 'feedCounts' | 'savedCount';

export type SidebarSnapshotResults = [
  PromiseSettledResult<Array<Feed>>,
  PromiseSettledResult<Array<Folder>>,
  PromiseSettledResult<UnreadCounts>,
  PromiseSettledResult<SavedPageUnreadCount>,
];

export interface SidebarRefreshStore {
  captureEpochs: () => Record<SnapshotField, number>;
  hasEpochChanged: (start: Readonly<Record<SnapshotField, number>>) => boolean;
  applySnapshot: (
    results: SidebarSnapshotResults,
    startEpochs: Readonly<Record<SnapshotField, number>>,
    countsAllowed: boolean
  ) => boolean;
}

export interface SidebarRefreshOwner {
  refresh: () => Promise<void>;
  invalidate: () => Promise<void>;
  joinIfActive: () => Promise<void> | null;
  markRerunNeeded: () => void;
  clear: () => void;
}

interface ActiveRefresh {
  promise: Promise<void>;
  startEpochs: Record<SnapshotField, number>;
  startQueueIdle: boolean;
  startQueueEpoch: number;
  rerunNeeded: boolean;
}

let storeRef: SidebarRefreshStore | null = null;
let activeRefresh: ActiveRefresh | null = null;
let deferredCountRefresh = false;
let deferredDrainUnsub: (() => void) | null = null;

const activeMounts = new Set<symbol>();
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let stopDrainListener: (() => void) | null = null;
let visibilityBound = false;

const isPollingMounted = (): boolean => activeMounts.size > 0;

const isCleanInFlight = (): boolean =>
  activeRefresh?.startQueueIdle === true &&
  activeRefresh.startQueueEpoch === queueEpoch();

const clearDeferredDrain = (): void => {
  deferredDrainUnsub?.();
  deferredDrainUnsub = null;
};

const clearPollingTimer = (): void => {
  if (pollingTimer === null) return;
  clearTimeout(pollingTimer);
  pollingTimer = null;
};

const schedulePollingTimer = (): void => {
  clearPollingTimer();
  if (!isPollingMounted() || document.hidden) return;
  pollingTimer = setTimeout(onPollingTick, SIDEBAR_REFRESH_INTERVAL_MS);
};

function onPollingTick(): void {
  pollingTimer = null;
  if (!isPollingMounted() || document.hidden) return;
  schedulePollingTimer();
  if (!queueIdle()) return;
  void startOrJoinRefresh(false);
}

const onVisibilityChange = (): void => {
  if (!isPollingMounted()) return;
  if (document.hidden) {
    clearPollingTimer();
    return;
  }
  schedulePollingTimer();
  void startOrJoinRefresh(false);
};

const onMountQueueDrain = (): void => {
  if (!isPollingMounted()) return;
  deferredCountRefresh = false;
  if (!isCleanInFlight()) {
    void startOrJoinRefresh(true);
  }
};

const onDeferredDrain = (): void => {
  clearDeferredDrain();
  if (isPollingMounted()) return;
  const shouldRun =
    deferredCountRefresh || (activeRefresh !== null && !isCleanInFlight());
  deferredCountRefresh = false;
  if (shouldRun && !isCleanInFlight()) {
    void startOrJoinRefresh(true);
  }
};

const ensureDeferredDrain = (): void => {
  if (isPollingMounted() || deferredDrainUnsub !== null) return;
  deferredDrainUnsub = onQueueDrained(onDeferredDrain);
};

const runRefreshRound = async (
  owner: ActiveRefresh,
  store: SidebarRefreshStore
): Promise<void> => {
  while (activeRefresh === owner) {
    const current = activeRefresh;
    current.rerunNeeded = false;
    current.startEpochs = store.captureEpochs();
    current.startQueueIdle = queueIdle();
    current.startQueueEpoch = queueEpoch();
    ensureDeferredDrain();
    const results: SidebarSnapshotResults = await Promise.allSettled([
      feedsApi.list(),
      foldersApi.list(),
      feedsApi.unreadCounts(),
      savedPagesApi.unreadCount(),
    ]);

    if (activeRefresh !== owner) return;

    const countsAllowed =
      current.startQueueIdle && queueEpoch() === current.startQueueEpoch;
    deferredCountRefresh = !countsAllowed;
    if (store.applySnapshot(results, current.startEpochs, countsAllowed)) {
      schedulePollingTimer();
    }
    if (!current.rerunNeeded) return;
  }
};

const startOrJoinRefresh = (invalidate: boolean): Promise<void> => {
  if (storeRef === null) return Promise.resolve();
  const store = storeRef;

  if (activeRefresh !== null) {
    if (invalidate || store.hasEpochChanged(activeRefresh.startEpochs)) {
      activeRefresh.rerunNeeded = true;
    }
    return activeRefresh.promise;
  }

  const state: ActiveRefresh = {
    promise: Promise.resolve(),
    startEpochs: store.captureEpochs(),
    startQueueIdle: queueIdle(),
    startQueueEpoch: queueEpoch(),
    rerunNeeded: false,
  };
  activeRefresh = state;
  state.promise = runRefreshRound(state, store).finally(() => {
    if (activeRefresh !== state) return;
    activeRefresh = null;
    if (!deferredCountRefresh) clearDeferredDrain();
  });

  return state.promise;
};

export const createSidebarRefresh = (
  store: SidebarRefreshStore
): SidebarRefreshOwner => {
  storeRef = store;
  return {
    refresh: () => startOrJoinRefresh(false),
    invalidate: () => startOrJoinRefresh(true),
    joinIfActive: () => activeRefresh?.promise ?? null,
    markRerunNeeded: () => {
      if (activeRefresh !== null) activeRefresh.rerunNeeded = true;
    },
    clear: () => {
      activeRefresh = null;
      deferredCountRefresh = false;
      clearDeferredDrain();
    },
  };
};

const stopPolling = (): void => {
  clearPollingTimer();
  if (visibilityBound) {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = false;
  }
  stopDrainListener?.();
  stopDrainListener = null;
};

export const clearSidebarRefresh = (): void => {
  activeMounts.clear();
  stopPolling();
};

export const mountSidebarRefresh = (): (() => void) => {
  const token = Symbol('sidebar-refresh');
  const wasEmpty = activeMounts.size === 0;
  activeMounts.add(token);

  if (wasEmpty) {
    clearDeferredDrain();
    stopDrainListener = onQueueDrained(onMountQueueDrain);
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = true;
    schedulePollingTimer();
  }

  return () => {
    if (!activeMounts.delete(token)) return;
    if (activeMounts.size === 0) stopPolling();
  };
};

onSessionCleared(clearSidebarRefresh);
