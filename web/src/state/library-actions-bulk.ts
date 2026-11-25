/**
 * Bulk library read actions (`LIB-READ-2`): mark-loaded-read and scope-wide mark-all, synced
 * through the per-article read sync so a failed batch never clobbers a newer per-row choice.
 */

import { feedItemsApi, feedsApi, foldersApi, savedPagesApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { LibraryArticle } from './library-store';
import { activeScope, retainedArticle, rows } from './library-store';
import { runReadBatch, targetOf } from './read-sync';
import type { LibraryScope } from './scope';
import * as sidebar from './sidebar';

const markIdsReadRequest = async (
  unread: ReadonlyArray<LibraryArticle>
): Promise<void> => {
  const savedIds = unread
    .filter((row) => row.kind === 'later')
    .map((row) => row.id);
  const feedItemIds = unread
    .filter((row) => row.kind === 'feed')
    .map((row) => row.id);
  await Promise.all([
    savedIds.length > 0
      ? savedPagesApi.markIdsRead(savedIds)
      : Promise.resolve(),
    feedItemIds.length > 0
      ? feedItemsApi.markIdsRead(feedItemIds)
      : Promise.resolve(),
  ]);
};

/** `LIB-READ-2`: marks every loaded unread row read in one batch per content kind. */
export const markLoadedRead = async (): Promise<void> => {
  const unread = rows().filter((row) => !row.read);
  if (unread.length === 0) return;

  const result = await runReadBatch(unread.map(targetOf), true, () =>
    markIdsReadRequest(unread)
  );
  if (result !== null && !result.ok && result.reverted > 0) {
    showToast(errorText(result.error), 'error');
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

/**
 * `LIB-READ-2`: scope-wide mark-all through the scope's own endpoint. The scope's unread counts
 * are cleared wholesale and reloaded from the server when the request fails.
 */
export const markScopeAllRead = async (
  targetScope?: LibraryScope
): Promise<void> => {
  const scope = targetScope ?? activeScope();
  const targets = matchingScopeTargets(scope).map(targetOf);
  clearScopeUnread(scope);

  const result = await runReadBatch(targets, false, () =>
    markScopeReadRequest(scope)
  );
  if (result === null || result.ok) return;

  await sidebar.invalidateSidebar();
  showToast(errorText(result.error), 'error');
};
