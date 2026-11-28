/**
 * Animated list membership changes: local removals, folder moves, and in-place reloads run inside
 * `runListTransition`, so rows leave, enter, and move instead of jumping.
 */

import { flush } from 'solid-js';
import { runListTransition } from '../ui';
import type { FetchedSnapshot } from './library';
import {
  fetchSnapshot,
  keepsCurrentRoute,
  loadScopeFirstPage,
} from './library';
import * as store from './library-store';
import {
  abortWindow,
  refreshWindow,
  refreshWindowAfterLayout,
} from './library-window';
import type { LibraryScope } from './scope';
import { isSameScope } from './scope';

/** Applies `apply` inside a list transition when it changes the visible rows, else directly. */
export const changeRows = (
  changes: boolean,
  apply: () => void
): Promise<void> => {
  if (changes) return runListTransition(apply);

  apply();
  return Promise.resolve();
};

const isCurrent = (generation: number): boolean =>
  store.requestState.generation === generation;

const showsList = (scope: LibraryScope, unreadOnly: boolean): boolean =>
  store.listBoundary() !== null &&
  store.rowIds().length > 0 &&
  isSameScope(scope, store.activeScope()) &&
  unreadOnly === store.activeUnreadOnly();

/**
 * `LIB-RELOAD-1` reloads that keep the scope (mark-all, unsubscribe): the current rows stay on
 * screen until the fresh snapshot arrives, then are replaced in a list transition. A failed
 * request, a list or routed-article change while it was in flight, or no list on screen falls
 * back to the full reload, which also reports the error.
 */
export const reloadScopeInPlace = async (
  scope: LibraryScope,
  unreadOnly: boolean
): Promise<void> => {
  if (!showsList(scope, unreadOnly)) {
    await loadScopeFirstPage(scope, unreadOnly);
    return;
  }

  const generation = ++store.requestState.generation;
  const revision = store.listRevision();
  abortWindow();
  store.setSnapshotLoading(true);
  flush();

  let snapshot: FetchedSnapshot | undefined;
  try {
    snapshot = await fetchSnapshot(scope, unreadOnly);
  } catch {
    snapshot = undefined;
  }
  if (!isCurrent(generation)) return;

  let committed = false;
  const previousRows = store.rowIds();
  const fresh = snapshot;
  // The route may have moved to another article, whose kept row the snapshot could lack.
  const canCommit = (current: FetchedSnapshot): boolean =>
    isCurrent(generation) &&
    store.listRevision() === revision &&
    keepsCurrentRoute(current, unreadOnly);
  if (fresh !== undefined && canCommit(fresh)) {
    await changeRows(store.changesRows(fresh), () => {
      if (!canCommit(fresh)) return;

      store.replaceSnapshot(fresh);
      store.setSnapshotLoading(false);
      flush();
      committed = true;
    });
  }
  if (!isCurrent(generation)) return;

  if (!committed) {
    await loadScopeFirstPage(scope, unreadOnly);
    return;
  }

  if (store.rowIds() === previousRows) refreshWindow();
  else refreshWindowAfterLayout();
};
