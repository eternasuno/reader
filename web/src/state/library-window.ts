import { flush } from 'solid-js';
import type { FeedItem, SavedPage } from '../api';
import { errorCodeOf, feedItemsApi, savedPagesApi } from '../api';
import type { LibraryArticle } from './library-store';
import * as store from './library-store';
import { beginRecordSnapshot } from './read-sync';
import type { LibraryScope } from './scope';

const isCurrent = (generation: number): boolean =>
  store.requestState.generation === generation;

type RenderedRange = { start: number; end: number };

type WindowRequest = { controller: AbortController; task?: Promise<void> };

const WINDOW_PADDING = 20;
const CONTENT_BATCH_SIZE = 200;
let desiredRange: RenderedRange | null = null;
let windowRequest: WindowRequest | null = null;
let refreshVersion = 0;
let awaitingLayout = false;

const expandedWindow = (range: RenderedRange | null): RenderedRange | null => {
  const count = store.rowIds().length;
  if (range === null || count === 0 || range.end < range.start) return null;

  return {
    start: Math.max(0, Math.min(range.start, count - 1) - WINDOW_PADDING),
    end: Math.min(count - 1, range.end + WINDOW_PADDING),
  };
};

const applyWindowBatch = (
  ids: ReadonlyArray<string>,
  items: ReadonlyArray<FeedItem | SavedPage>,
  kind: LibraryArticle['kind'],
  seq: number,
  stale: boolean,
  boundary: string | null
): void => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const currentIds = new Set(store.snapshotIds());
  const omitted: Array<string> = [];
  const received: Array<LibraryArticle> = [];
  for (const id of ids) {
    if (!currentIds.has(id)) continue;

    const item = byId.get(id);
    if (item !== undefined) received.push(store.toLibraryArticle(kind, item));
    else if (
      boundary === store.listBoundary() &&
      !store.hasNewerRecord(id, seq)
    )
      omitted.push(id);
  }

  store.removeListIds(omitted);
  store.mergeWindowRecords(received, seq, stale);
  flush();
};

const loadWindowBatch = async (
  scope: LibraryScope,
  ids: Array<string>,
  generation: number,
  signal: AbortSignal
): Promise<void> => {
  const version = refreshVersion;
  const boundary = store.listBoundary();
  const snapshot = beginRecordSnapshot();
  try {
    const { items } = await (scope.kind === 'later'
      ? savedPagesApi.byIds(ids, { signal })
      : feedItemsApi.byIds(ids, { signal }));
    if (!isCurrent(generation)) return;

    applyWindowBatch(
      ids,
      items,
      store.articleKindOf(scope),
      snapshot.seq,
      version !== refreshVersion,
      boundary
    );
  } finally {
    snapshot.release();
  }
};

const nextBatch = (
  range: RenderedRange | null,
  processed: ReadonlySet<string>
): Array<string> => {
  const window = expandedWindow(range);
  if (window === null) return [];

  return store
    .rowIds()
    .slice(window.start, window.end + 1)
    .filter((id) => !processed.has(id) && store.needsWindowRecord(id))
    .slice(0, CONTENT_BATCH_SIZE);
};

const fetchBatch = async (
  scope: LibraryScope,
  ids: Array<string>,
  generation: number,
  signal: AbortSignal
): Promise<string | null> => {
  try {
    await loadWindowBatch(scope, ids, generation, signal);
    return null;
  } catch (error) {
    return errorCodeOf(error);
  }
};

const isDesired = (range: RenderedRange | null, version: number): boolean =>
  range === desiredRange && version === refreshVersion;

const isWindowFailure = (
  error: string | null,
  range: RenderedRange | null,
  version: number,
  generation: number
): error is string =>
  error !== null && isCurrent(generation) && isDesired(range, version);

const runWindow = async (controller: AbortController): Promise<void> => {
  const generation = store.requestState.generation;
  const scope = store.activeScope();
  const processed = new Set<string>();
  let range = desiredRange;
  let version = refreshVersion;
  try {
    while (isCurrent(generation) && !awaitingLayout) {
      if (!isDesired(range, version)) {
        range = desiredRange;
        version = refreshVersion;
        processed.clear();
      }

      const ids = nextBatch(range, processed);
      if (ids.length === 0) {
        store.setWindowError(null);
        return;
      }

      const failure = await fetchBatch(
        scope,
        ids,
        generation,
        controller.signal
      );
      if (isWindowFailure(failure, range, version, generation)) {
        store.setWindowError(failure);
        return;
      }

      ids.forEach((id) => {
        processed.add(id);
      });
    }
  } finally {
    windowRequest = null;
    flush();
    if (!isCurrent(generation)) startWindow();
  }
};

export const startWindow = (): void => {
  if (
    windowRequest !== null ||
    awaitingLayout ||
    store.listBoundary() === null ||
    expandedWindow(desiredRange) === null
  )
    return;

  const request: WindowRequest = {
    controller: new AbortController(),
  };
  windowRequest = request;
  request.task = runWindow(request.controller);
};

export const requestWindow = (range: RenderedRange): void => {
  if (desiredRange?.start !== range.start || desiredRange.end !== range.end)
    desiredRange = range;

  store.setCacheWindow(expandedWindow(desiredRange));
  startWindow();
};

export const refreshWindow = (): void => {
  refreshVersion += 1;
  store.markRecordsStale();
  startWindow();
};

export const refreshWindowAfterLayout = (): void => {
  awaitingLayout = true;
  refreshWindow();
  const generation = store.requestState.generation;
  // Scroll events from anchor restoration and their range reports run during rendering.
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (!isCurrent(generation)) return;

      awaitingLayout = false;
      startWindow();
    }, 0);
  });
};

/**
 * Aborts the in-flight content request but keeps the desired range for the next request. Also
 * ends a layout wait from the previous generation, whose frame callback no longer clears it.
 */
export const abortWindow = (): void => {
  awaitingLayout = false;
  windowRequest?.controller.abort();
};

export const resetWindow = (): void => {
  awaitingLayout = false;
  desiredRange = null;
  windowRequest?.controller.abort();
};

export const retryWindow = async (): Promise<void> => {
  store.setWindowError(null);
  startWindow();
  await windowRequest?.task;
};
