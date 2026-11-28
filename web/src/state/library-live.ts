import { flush } from 'solid-js';
import { fetchSnapshot, isFirstRefreshWaiting } from './library';
import {
  activeScope,
  activeUnreadOnly,
  isLibraryMounted,
  listBoundary,
  listRevision,
  replaceSnapshot,
  requestState,
  rowIds,
  snapshotLoading,
} from './library-snapshot';
import { trimRecordCache } from './library-store';
import { refreshWindow, refreshWindowAfterLayout } from './library-window';
import { queueEpoch, queueIdle } from './read-sync';
import { onSessionCleared } from './session';
import { onLibraryTick } from './sidebar-refresh';

const activeMounts = new Set<symbol>();
let stopListening: (() => void) | null = null;
let activeRequest: { valid: boolean } | null = null;

const canApplyLiveSnapshot = (): boolean =>
  isLibraryMounted() && !document.hidden && queueIdle();

const canStartLiveSnapshot = (): boolean =>
  activeRequest === null &&
  canApplyLiveSnapshot() &&
  listBoundary() !== null &&
  !snapshotLoading() &&
  !isFirstRefreshWaiting();

const fetchLiveSnapshot = async (): Promise<void> => {
  if (!canStartLiveSnapshot()) return;

  const request = { valid: true };
  const generation = requestState.generation;
  const revision = listRevision();
  const epoch = queueEpoch();
  activeRequest = request;

  try {
    let snapshot: Awaited<ReturnType<typeof fetchSnapshot>>;
    try {
      snapshot = await fetchSnapshot(activeScope(), activeUnreadOnly());
    } catch {
      // A later tick can retry without interrupting the active list.
      return;
    }

    const stillCurrent =
      request.valid &&
      generation === requestState.generation &&
      revision === listRevision() &&
      epoch === queueEpoch();
    if (!stillCurrent || !canApplyLiveSnapshot()) return;

    const previousRows = rowIds();
    replaceSnapshot(snapshot);
    flush();
    if (rowIds() === previousRows) refreshWindow();
    else refreshWindowAfterLayout();

    trimRecordCache();
  } finally {
    activeRequest = null;
  }
};

const stopLiveList = (): void => {
  stopListening?.();
  stopListening = null;
  if (activeRequest !== null) activeRequest.valid = false;
};

/** `LIB-LIVE-1`: replaces the active snapshot in place on sidebar ticks. */
export const mountLiveList = (): (() => void) => {
  const token = Symbol('live-list');
  activeMounts.add(token);
  stopListening ??= onLibraryTick(() => void fetchLiveSnapshot());

  return () => {
    if (!activeMounts.delete(token)) return;
    if (activeMounts.size === 0) stopLiveList();
  };
};

onSessionCleared(() => {
  activeMounts.clear();
  stopLiveList();
});
