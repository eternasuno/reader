/**
 * Bulk library read actions (`LIB-READ-2`): mark-loaded-read and scope-wide mark-all. Tracks
 * per-article ownership so a failed bulk rollback never clobbers a newer per-row choice or a
 * newer scope generation (`LIB-RELOAD-1`).
 */

import { flush } from 'solid-js';
import { feedItemsApi, feedsApi, foldersApi, savedPagesApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import { readTracker } from './library-mutations';
import type { LibraryArticle, LibraryArticlePatch } from './library-store';
import {
  activeScope,
  articleById,
  patchManyArticles,
  requestState,
  retainedArticle,
  rows,
} from './library-store';
import type { LibraryScope } from './scope';
import * as sidebar from './sidebar';

interface UnreadSplit {
  unread: ReadonlyArray<LibraryArticle>;
  savedIds: Array<string>;
  feedItemIds: Array<string>;
  feedCounts: Map<string, number>;
}

const countByFeed = (
  feedRows: ReadonlyArray<LibraryArticle>
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const row of feedRows) {
    if (row.kind !== 'feed') continue;
    counts.set(row.feedId, (counts.get(row.feedId) ?? 0) + 1);
  }

  return counts;
};

const splitUnreadRows = (
  currentRows: ReadonlyArray<LibraryArticle>
): UnreadSplit => {
  const unread = currentRows.filter((row) => !row.read);
  const feedRows = unread.filter((row) => row.kind === 'feed');

  return {
    unread,
    savedIds: unread.filter((row) => row.kind === 'later').map((row) => row.id),
    feedItemIds: feedRows.map((row) => row.id),
    feedCounts: countByFeed(feedRows),
  };
};

const markIdsReadRequest = async (split: UnreadSplit): Promise<void> => {
  await Promise.all([
    split.savedIds.length > 0
      ? savedPagesApi.markIdsRead(split.savedIds)
      : Promise.resolve(),
    split.feedItemIds.length > 0
      ? feedItemsApi.markIdsRead(split.feedItemIds)
      : Promise.resolve(),
  ]);
};

const applyUnreadDecrements = (split: UnreadSplit): void => {
  if (split.savedIds.length > 0)
    sidebar.adjustSavedUnread(-split.savedIds.length);
  for (const [feedId, count] of split.feedCounts) {
    sidebar.adjustFeedUnread(feedId, -count);
  }
};

const beginBulkTokens = (
  targets: ReadonlyArray<LibraryArticle>
): Map<string, number> => {
  const tokens = new Map<string, number>();
  for (const row of targets) {
    tokens.set(row.id, readTracker.begin(row.id, row.read, true));
  }
  return tokens;
};

const adjustArticleUnread = (article: LibraryArticle, read: boolean): void => {
  if (article.kind === 'later') {
    sidebar.adjustSavedUnread(read ? -1 : 1);
  } else {
    sidebar.adjustFeedUnread(article.feedId, read ? -1 : 1);
  }
};

const collectBulkUpdate = (
  id: string,
  targetRead: boolean,
  updates: Array<{ id: string; patch: LibraryArticlePatch }>,
  syncUnread: boolean
): void => {
  const current = articleById(id);
  if (current === null || current.read === targetRead) return;

  updates.push({ id, patch: { read: targetRead } });
  if (syncUnread) adjustArticleUnread(current, targetRead);
};

const flushBulkUpdates = (
  updates: ReadonlyArray<{ id: string; patch: LibraryArticlePatch }>
): void => {
  if (updates.length === 0) return;

  patchManyArticles(updates);
  flush();
};

const succeedBulkTokens = (
  tokens: ReadonlyMap<string, number>,
  startGeneration: number
): void => {
  const sameScope = requestState.generation === startGeneration;
  const updates: Array<{ id: string; patch: LibraryArticlePatch }> = [];
  for (const [id, token] of tokens) {
    const result = readTracker.succeed(id, token, true);
    if (result !== null && sameScope) {
      collectBulkUpdate(id, result.targetRead, updates, true);
    }
  }
  flushBulkUpdates(updates);
};

const rollbackOwnedBulk = (
  tokens: ReadonlyMap<string, number>,
  canTouchRows: boolean
): boolean => {
  let anyOwned = false;
  const updates: Array<{ id: string; patch: LibraryArticlePatch }> = [];

  for (const [id, token] of tokens) {
    const result = readTracker.fail(id, token);
    if (result === null) continue;
    if (result.owns) anyOwned = true;
    if (canTouchRows) collectBulkUpdate(id, result.targetRead, updates, false);
  }

  flushBulkUpdates(updates);
  return anyOwned;
};

const handleBulkFailure = async (
  error: unknown,
  tokens: ReadonlyMap<string, number>,
  startGeneration: number,
  emptyTarget = false
): Promise<void> => {
  const sameScope = requestState.generation === startGeneration;
  const anyOwned = rollbackOwnedBulk(tokens, sameScope);

  if (!sameScope || anyOwned || emptyTarget) {
    await sidebar.invalidateSidebar();
    showToast(errorText(error), 'error');
  }
};

/** `LIB-READ-2`: marks every loaded unread row read in one batch per content kind. */
export const markLoadedRead = async (): Promise<void> => {
  const startGeneration = requestState.generation;
  const split = splitUnreadRows(rows());
  if (split.unread.length === 0) return;

  const tokens = beginBulkTokens(split.unread);
  patchManyArticles(
    split.unread.map((row) => ({ id: row.id, patch: { read: true } }))
  );
  applyUnreadDecrements(split);
  flush();

  try {
    await markIdsReadRequest(split);
    succeedBulkTokens(tokens, startGeneration);
  } catch (error) {
    await handleBulkFailure(error, tokens, startGeneration);
  }
};

const scopeMatchesRow = (scope: LibraryScope, row: LibraryArticle): boolean => {
  switch (scope.kind) {
    case 'later':
      return row.kind === 'later';
    case 'all':
      return row.kind === 'feed';
    case 'feed':
      return row.kind === 'feed' && row.feedId === scope.feedId;
    case 'folder':
      return (
        row.kind === 'feed' &&
        sidebar
          .folderFeeds(scope.folderId)
          .some((feed) => feed.id === row.feedId)
      );
  }
};

const clearScopeUnread = (scope: LibraryScope): void => {
  switch (scope.kind) {
    case 'later':
      sidebar.setSavedUnread(0);
      break;
    case 'all':
      sidebar.clearAllFeedsUnread();
      break;
    case 'feed':
      sidebar.clearFeedUnread(scope.feedId);
      break;
    case 'folder':
      sidebar.clearFolderUnread(scope.folderId);
      break;
  }
};

const markScopeReadRequest = async (scope: LibraryScope): Promise<void> => {
  switch (scope.kind) {
    case 'later':
      await savedPagesApi.markAllRead();
      break;
    case 'all':
      await feedItemsApi.markAllRead();
      break;
    case 'feed':
      await feedsApi.markAllRead(scope.feedId);
      break;
    case 'folder':
      await foldersApi.markAllRead(scope.folderId);
      break;
  }
};

const matchingScopeTargets = (scope: LibraryScope): Array<LibraryArticle> => {
  const shouldMark = (row: LibraryArticle): boolean =>
    !row.read && scopeMatchesRow(scope, row);
  const targets = rows().filter(shouldMark);
  const deepLinked = retainedArticle();
  if (deepLinked !== null && shouldMark(deepLinked)) {
    targets.push(deepLinked);
  }
  return targets;
};

/** `LIB-READ-2`: scope-wide mark-all through the scope's own endpoint. */
export const markScopeAllRead = async (
  targetScope?: LibraryScope
): Promise<void> => {
  const startGeneration = requestState.generation;
  const scope = targetScope ?? activeScope();
  const markedRows = matchingScopeTargets(scope);
  const tokens = beginBulkTokens(markedRows);

  patchManyArticles(
    markedRows.map((row) => ({ id: row.id, patch: { read: true } }))
  );
  clearScopeUnread(scope);
  flush();

  try {
    await markScopeReadRequest(scope);
    succeedBulkTokens(tokens, startGeneration);
  } catch (error) {
    await handleBulkFailure(
      error,
      tokens,
      startGeneration,
      markedRows.length === 0
    );
  }
};
