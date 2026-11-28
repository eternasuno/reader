/**
 * Bulk library read actions (`LIB-READ-2`): mark-read-above and pessimistic barrier-serialized
 * scope-wide mark-all.
 */

import { feedItemsApi, feedsApi, foldersApi, savedPagesApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { ScopeMatcher } from './library-mark-all';
import { beginScopeMark, scopeMatcher } from './library-mark-all';
import { reloadScopeInPlace } from './library-motion';
import {
  activeScope,
  activeUnreadOnly,
  articleById,
  articleKindOf,
  feedIdOf,
  idsThroughVisibleEnd,
  isLibraryMounted,
  listBoundary,
} from './library-store';
import type {
  BarrierOutcome,
  EnqueueBarrierResult,
  ReadTarget,
  UnknownReadTarget,
} from './read-sync';
import { enqueueBarrier, requestReadMany, targetOf } from './read-sync';
import { isAmbiguousError } from './read-sync-transport';
import { refreshOpenArticle } from './reader';
import type { LibraryScope } from './scope';
import { isSameScope } from './scope';
import { sessionGeneration } from './session';
import * as sidebar from './sidebar';

export { isMarkingScope } from './library-mark-all';

/** `LIB-READ-2`: marks IDs from the list top through the last viewport row read. */
export const markReadAbove = (): void => {
  const ids = idsThroughVisibleEnd();
  if (ids.length === 0) return;

  const kind = articleKindOf(activeScope());
  requestReadMany(
    ids.flatMap<ReadTarget | UnknownReadTarget>((id) => {
      const row = articleById(id);
      if (row !== null) return row.read ? [] : [targetOf(row)];

      return [{ id, kind, feedId: kind === 'feed' ? feedIdOf(id) : null }];
    })
  );
};

const markScopeReadRequest = async (
  scope: LibraryScope,
  before: string
): Promise<void> => {
  switch (scope.kind) {
    case 'later':
      await savedPagesApi.markAllRead(before);
      break;
    case 'all':
      await feedItemsApi.markAllRead(before);
      break;
    case 'feed':
      await feedsApi.markAllRead(scope.feedId, before);
      break;
    case 'folder':
      await foldersApi.markAllRead(scope.folderId, before);
      break;
  }
};

const fetchScopeBoundary = async (scope: LibraryScope): Promise<string> => {
  if (scope.kind === 'later') {
    const res = await savedPagesApi.unreadCount();
    return res.boundary;
  }

  const res = await feedsApi.unreadCounts();
  return res.boundary;
};

const resolveClickBoundary = (scope: LibraryScope): string | null =>
  (isSameScope(activeScope(), scope) ? listBoundary() : null) ??
  sidebar.scopeCountBoundary(scope);

/**
 * One mark-all click: the boundary it sent and the scope membership when it was sent (once known),
 * and the error to toast on failure.
 */
interface MarkAllRequest {
  before: string | null;
  matches: ScopeMatcher;
  error: unknown;
}

/**
 * Runs inside the queue. A session that ended since the click (`startSession`) must not send the
 * write, so the generation is checked after the boundary GET; the caller discards the result.
 */
const executeMarkAllBarrier = async (
  scope: LibraryScope,
  initialBefore: string | null,
  startSession: number,
  request: MarkAllRequest
): Promise<BarrierOutcome> => {
  let before = initialBefore;
  if (before === null) {
    try {
      before = await fetchScopeBoundary(scope);
    } catch (error) {
      request.error = error;
      return 'failed';
    }
  }
  if (sessionGeneration() !== startSession) return 'failed';

  request.before = before;
  request.matches = scopeMatcher(scope);
  try {
    await markScopeReadRequest(scope, before);
    return 'ok';
  } catch (error) {
    request.error = error;
    return isAmbiguousError(error) ? 'ambiguous' : 'failed';
  }
};

/**
 * On `ok` or `ambiguous`: reloads the active list from page 1 when a library page is mounted,
 * whichever scope was marked. Counts refresh once: a mounted library's sidebar subscriber already
 * refreshed them when the queue drained, so the explicit refresh covers only the unmounted case.
 */
const applyMarkAllSuccess = async (
  covers: ScopeMatcher,
  startSession: number
): Promise<void> => {
  const mounted = isLibraryMounted();
  const currentScope = activeScope();
  const reload = mounted
    ? reloadScopeInPlace(currentScope, activeUnreadOnly())
    : Promise.resolve();
  await Promise.all([reload, refreshOpenArticle(covers)]);
  if (mounted || sessionGeneration() !== startSession) return;
  await sidebar.invalidateSidebar();
};

/**
 * `LIB-READ-2`: pessimistic scope-wide mark-all serialized as a barrier in the read-sync queue.
 * Nothing changes on screen until the server answers. On `ok` or `ambiguous`, reloads the active
 * list (see `applyMarkAllSuccess`) and refreshes the open reader article if it belonged to the
 * marked scope when the write was sent. Ends silently when the session ends before the request settles.
 */
export const markScopeAllRead = async (
  targetScope?: LibraryScope
): Promise<void> => {
  const scope = targetScope ?? activeScope();
  const startSession = sessionGeneration();
  const initialBefore = resolveClickBoundary(scope);
  const finishMark = beginScopeMark(scope);
  const request: MarkAllRequest = {
    before: null,
    matches: () => false,
    error: undefined,
  };

  let outcome: EnqueueBarrierResult;
  try {
    outcome = await enqueueBarrier({
      affects: (entry) =>
        request.before !== null &&
        entry.id <= request.before &&
        request.matches(entry),
      execute: () =>
        executeMarkAllBarrier(scope, initialBefore, startSession, request),
    });
  } finally {
    finishMark();
  }

  if (outcome === 'cleared' || sessionGeneration() !== startSession) return;
  if (outcome === 'failed') {
    showToast(errorText(request.error), 'error');
    return;
  }

  await applyMarkAllSuccess(request.matches, startSession);
};
