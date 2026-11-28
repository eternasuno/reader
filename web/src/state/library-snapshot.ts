import { createMemo, createSignal } from 'solid-js';
import { feedMoveTracker } from './library-mutations';
import type { LibraryScope } from './scope';

const [activeScope, setActiveScope] = createSignal<LibraryScope>({
  kind: 'later',
});
const [activeUnreadOnly, setActiveUnreadOnly] = createSignal(false);
/**
 * `LIB-FILTER-1`: the routed article stays in unread-only snapshots even once read. A plain value
 * (not a signal) so a snapshot request reads the latest route synchronously.
 */
let routedArticle: string | null = null;
const routeArticleId = (): string | null => routedArticle;
const setRouteArticleId = (articleId: string | null): void => {
  routedArticle = articleId;
};
type ListSnapshot = {
  ids: ReadonlyArray<string>;
  feedIds: ReadonlyMap<string, string>;
  boundary: string | null;
};

const emptySnapshot: ListSnapshot = {
  ids: [],
  feedIds: new Map(),
  boundary: null,
};
const [list, setList] = createSignal(emptySnapshot);
const [folderMembership, setFolderMembership] = createSignal<
  ReadonlyMap<string, string | null>
>(new Map());
const [listRevision, bumpListRevision] = createSignal(0);
const [snapshotLoading, setSnapshotLoading] = createSignal(false);
const [snapshotError, setSnapshotError] = createSignal<string | null>(null);
const [windowError, setWindowError] = createSignal<string | null>(null);
const [visibleRange, writeVisibleRange] = createSignal<{
  first: number;
  last: number;
} | null>(null);
const locallyRemoved = new Set<string>();

export {
  activeScope,
  activeUnreadOnly,
  listRevision,
  routeArticleId,
  setActiveScope,
  setActiveUnreadOnly,
  setRouteArticleId,
  setSnapshotError,
  setSnapshotLoading,
  setWindowError,
  snapshotError,
  snapshotLoading,
  windowError,
};

export const requestState = { generation: 0 };

export const listBoundary = (): string | null => list().boundary;

export const feedIdOf = (id: string): string | null =>
  list().feedIds.get(id) ?? null;

const sameIds = (
  previous: ReadonlyArray<string>,
  next: ReadonlyArray<string>
): boolean =>
  previous.length === next.length &&
  previous.every((id, index) => id === next[index]);

/** IDs shown in the active scope after folder membership overrides. */
const visibleIds = (
  ids: ReadonlyArray<string>,
  feedIds: ReadonlyMap<string, string>,
  overrides: ReadonlyMap<string, string | null>
): ReadonlyArray<string> => {
  const scope = activeScope();
  if (scope.kind !== 'folder') return ids;

  return ids.filter((id) => {
    const feedId = feedIds.get(id);
    return (
      feedId === undefined ||
      !overrides.has(feedId) ||
      overrides.get(feedId) === scope.folderId
    );
  });
};

/** Overrides a snapshot replacement keeps: only those of feeds with a move still pending. */
const pendingOverrides = (
  overrides: ReadonlyMap<string, string | null>
): Map<string, string | null> =>
  new Map(
    [...overrides].filter(([feedId]) => feedMoveTracker.hasPendingMove(feedId))
  );

export const rowIds = createMemo(
  (): ReadonlyArray<string> => {
    const { ids, feedIds } = list();
    return visibleIds(ids, feedIds, folderMembership());
  },
  {
    equals: sameIds,
  }
);

export const setVisibleRange = (
  range: { first: number; last: number } | null
): void => {
  writeVisibleRange(range);
};

export const idsThroughVisibleEnd = (): ReadonlyArray<string> => {
  const range = visibleRange();
  return range === null ? [] : rowIds().slice(0, range.last + 1);
};

export const groupStartIds = createMemo(() => {
  const starts = new Set<string>();
  const scope = activeScope();
  if (scope.kind !== 'all' && scope.kind !== 'folder') return starts;

  let previous: string | null = null;
  for (const id of rowIds()) {
    const feedId = feedIdOf(id);
    if (feedId !== null && feedId !== previous) starts.add(id);
    previous = feedId;
  }

  return starts;
});

export const invalidateLiveSnapshot = (): void => {
  bumpListRevision((revision) => revision + 1);
};

export const acceptSnapshot = (snapshot: ListSnapshot): void => {
  const localIds = list().ids;
  const ids = new Set(localIds);
  const feedIds = new Map<string, string>();
  for (const id of snapshot.ids) {
    if (locallyRemoved.has(id)) continue;

    ids.add(id);
    const feedId = snapshot.feedIds.get(id);
    if (feedId !== undefined) feedIds.set(id, feedId);
  }

  setList({ ids: [...ids], feedIds, boundary: snapshot.boundary });
  locallyRemoved.clear();
  invalidateLiveSnapshot();
};

/** Whether {@link replaceSnapshot} would change the visible rows, folder overrides included. */
export const changesRows = (snapshot: ListSnapshot): boolean =>
  !sameIds(
    rowIds(),
    visibleIds(
      snapshot.ids,
      snapshot.feedIds,
      pendingOverrides(folderMembership())
    )
  );

export const replaceSnapshot = (snapshot: ListSnapshot): void => {
  const overrides = folderMembership();
  const kept = pendingOverrides(overrides);
  const retiredOverrides = kept.size !== overrides.size;
  if (retiredOverrides) setFolderMembership(kept);

  const current = list();
  if (sameIds(current.ids, snapshot.ids)) {
    setList({ ...current, boundary: snapshot.boundary });
    if (retiredOverrides) invalidateLiveSnapshot();

    return;
  }

  setList({
    ids: snapshot.ids,
    feedIds: snapshot.feedIds,
    boundary: snapshot.boundary,
  });
  invalidateLiveSnapshot();
};

/** Whether moving `feedId` to `folderId` would show or hide its rows in the active folder list. */
export const folderMoveChangesRows = (
  feedId: string,
  folderId: string | null
): boolean => {
  const scope = activeScope();
  if (scope.kind !== 'folder') return false;

  const overrides = folderMembership();
  const shown =
    !overrides.has(feedId) || overrides.get(feedId) === scope.folderId;
  if (shown === (folderId === scope.folderId)) return false;

  return [...list().feedIds.values()].includes(feedId);
};

export const updateFolderMembership = (
  feedId: string,
  folderId: string | null
): boolean => {
  if (activeScope().kind !== 'folder') return false;

  const overrides = folderMembership();
  if (overrides.get(feedId) === folderId) return false;

  setFolderMembership(new Map(overrides).set(feedId, folderId));
  invalidateLiveSnapshot();

  return true;
};

let libraryMounts = 0;

/** The active scope can outlive the library page. */
export const trackLibraryMount = (): (() => void) => {
  libraryMounts += 1;
  return () => {
    libraryMounts -= 1;
  };
};

export const isLibraryMounted = (): boolean => libraryMounts > 0;

export const snapshotIds = (): ReadonlyArray<string> => list().ids;

export const removeListIds = (ids: ReadonlyArray<string>): void => {
  if (ids.length === 0) return;

  const snapshot = list();
  if (snapshot.boundary === null) {
    for (const id of ids) locallyRemoved.add(id);
  }

  invalidateLiveSnapshot();
  const removed = new Set(ids);
  const remaining = snapshot.ids.filter((id) => !removed.has(id));
  if (remaining.length === snapshot.ids.length) return;

  const feedIds = new Map(snapshot.feedIds);
  for (const id of removed) feedIds.delete(id);
  setList({ ...snapshot, ids: remaining, feedIds });
};

export const clearList = (): void => {
  locallyRemoved.clear();
  setList(emptySnapshot);
  setFolderMembership(new Map());
  setVisibleRange(null);
};

export const prependListId = (id: string): void => {
  const snapshot = list();
  locallyRemoved.delete(id);
  if (snapshot.ids[0] === id) return;

  setList({
    ...snapshot,
    ids: [id, ...snapshot.ids.filter((entry) => entry !== id)],
  });
  invalidateLiveSnapshot();
};
