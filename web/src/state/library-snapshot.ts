import { createMemo, createSignal } from 'solid-js';
import type { LibraryScope } from './scope';

const [activeScope, setActiveScope] = createSignal<LibraryScope>({
  kind: 'later',
});
const [activeUnreadOnly, setActiveUnreadOnly] = createSignal(false);
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
  setActiveScope,
  setActiveUnreadOnly,
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

export const rowIds = createMemo(
  (): ReadonlyArray<string> => {
    const { ids, feedIds } = list();
    const scope = activeScope();
    if (scope.kind !== 'folder') return ids;

    const overrides = folderMembership();
    return ids.filter((id) => {
      const feedId = feedIds.get(id);
      return (
        feedId === undefined ||
        !overrides.has(feedId) ||
        overrides.get(feedId) === scope.folderId
      );
    });
  },
  {
    equals: (previous, next) =>
      previous.length === next.length &&
      previous.every((id, index) => id === next[index]),
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
  bumpListRevision((revision) => revision + 1);
};

export const updateFolderMembership = (
  feedId: string,
  folderId: string | null
): void => {
  if (activeScope().kind !== 'folder') return;

  const overrides = folderMembership();
  if (overrides.get(feedId) === folderId) return;

  setFolderMembership(new Map(overrides).set(feedId, folderId));
  bumpListRevision((revision) => revision + 1);
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

  const removed = new Set(ids);
  const remaining = snapshot.ids.filter((id) => !removed.has(id));
  if (remaining.length === snapshot.ids.length) return;

  const feedIds = new Map(snapshot.feedIds);
  for (const id of removed) feedIds.delete(id);
  setList({ ...snapshot, ids: remaining, feedIds });
  bumpListRevision((revision) => revision + 1);
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
  bumpListRevision((revision) => revision + 1);
};
