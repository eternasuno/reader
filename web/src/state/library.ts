/**
 * Library list loading and local row mutations (`LIB-SCOPE-1`, `LIB-LIST-1`, `LIB-RELOAD-1`,
 * `LIB-FILTER-1`, `SP-ADD-1`, `FD-PREF-1`). Row actions live in `library-actions.ts` and are
 * re-exported here so `state/index.ts` keeps one public surface.
 */

import { flush } from 'solid-js';
import type { Feed, SavedPage, SortOrder } from '../api';
import {
  errorCodeOf,
  feedItemsApi,
  feedsApi,
  foldersApi,
  savedPagesApi,
} from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import {
  isShowingEmptyFeed,
  waitForFirstRefresh,
} from './library-first-refresh';
import { feedMoveTracker, LatestTokenMap } from './library-mutations';
import type { LibraryArticle } from './library-store';
import * as store from './library-store';
import { resetWindow, retryWindow, startWindow } from './library-window';
import { beginRecordSnapshot, onQueueDrained } from './read-sync';
import type { LibraryScope } from './scope';
import { feedIconCandidates, hostnameOf, siteIconUrl } from './scope';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

export * from './library-actions';
export * from './library-actions-bulk';
export * from './library-actions-feed';
export type {
  ArticleReadFallback,
  LibraryArticle,
  LibraryArticlePatch,
} from './library-store';
export {
  activeScope,
  activeUnreadOnly,
  articleById,
  feedIdOf,
  groupStartIds,
  idsThroughVisibleEnd,
  isLibraryMounted,
  listBoundary,
  listRevision,
  /** Patches an article record in place (used by the reader after extraction, `RD-EXTRACT-1`). */
  patchArticle as patchArticleLocal,
  retainReaderArticle,
  rowIds,
  setVisibleRange,
  snapshotError,
  snapshotLoading,
  trackLibraryMount,
  upsertArticle,
  windowError,
} from './library-store';
export { refreshWindow, requestWindow } from './library-window';

const feedOrderTokens = new LatestTokenMap();

export interface ArticleSource {
  title: string;
  iconSrcs: ReadonlyArray<string>;
}

/**
 * `LIB-ROW-1`: saved pages are labelled by hostname, feed items by their feed. Read
 * reactively so rows loaded before the sidebar feeds still resolve.
 */
export const articleSource = (article: LibraryArticle): ArticleSource => {
  if (article.kind === 'later') {
    const icon = siteIconUrl(article.url);
    return { title: hostnameOf(article.url), iconSrcs: icon ? [icon] : [] };
  }

  const feed = sidebar.feeds().find((entry) => entry.id === article.feedId);

  return {
    title: feed?.title ?? '',
    iconSrcs: feed ? feedIconCandidates(feed) : [],
  };
};

const fetchFeedOrder = (
  scope: Exclude<LibraryScope, { kind: 'later' }>,
  unread: boolean
) => {
  switch (scope.kind) {
    case 'all':
      return feedItemsApi.order({ unread });
    case 'feed':
      return feedsApi.itemsOrder(scope.feedId, { unread });
    case 'folder':
      return foldersApi.itemsOrder(scope.folderId, { unread });
  }
};

const fetchSnapshot = async (
  scope: LibraryScope,
  unread: boolean
): Promise<Parameters<typeof store.acceptSnapshot>[0]> => {
  if (scope.kind === 'later') {
    const { boundary, ids } = await savedPagesApi.order({ unread });
    return { boundary, ids, feedIds: new Map() };
  }

  const { boundary, groups } = await fetchFeedOrder(scope, unread);
  const feedIds = new Map<string, string>();
  const ids = groups.flatMap((group) => {
    for (const id of group.ids) feedIds.set(id, group.feedId);
    return group.ids;
  });
  return { boundary, ids, feedIds };
};

const isCurrent = (generation: number): boolean =>
  store.requestState.generation === generation;

/** `LIB-RELOAD-1`: loads a fresh snapshot and discards earlier in-flight responses. */
export const loadScopeFirstPage = async (
  scope: LibraryScope,
  unreadOnly: boolean
): Promise<void> => {
  const generation = ++store.requestState.generation;
  resetWindow();
  store.setActiveScope(scope);
  store.setActiveUnreadOnly(unreadOnly);
  store.clearRows();
  store.setSnapshotError(null);
  store.setWindowError(null);
  store.setSnapshotLoading(true);
  flush();

  if (scope.kind === 'folder') {
    for (const [feedId, folderId] of feedMoveTracker.pendingFolders()) {
      store.updateFolderMembership(feedId, folderId);
    }
  }

  try {
    const snapshot = await fetchSnapshot(scope, unreadOnly);
    if (isCurrent(generation)) store.acceptSnapshot(snapshot);
  } catch (error) {
    if (isCurrent(generation)) store.setSnapshotError(errorCodeOf(error));
  } finally {
    if (isCurrent(generation)) {
      store.setSnapshotLoading(false);
      flush();
      startWindow();
    }
  }
};

/**
 * `FD-SUB-2`: a new subscription is refreshed in the background, so while its still-empty list is
 * shown the client waits for that first refresh, then reloads the list and sidebar.
 */
export const reloadAfterFirstRefresh = async (
  feedId: string,
  signal: AbortSignal
): Promise<void> => {
  if (!(await waitForFirstRefresh(feedId, signal))) return;

  if (signal.aborted || !isShowingEmptyFeed(feedId)) return;

  await sidebar.invalidateSidebar();
  if (!signal.aborted && isShowingEmptyFeed(feedId))
    await loadScopeFirstPage(store.activeScope(), store.activeUnreadOnly());
};

let firstRefreshWait: AbortController | null = null;

/** `FD-SUB-2`: starts waiting for a just-subscribed feed, replacing any earlier wait. */
export const startFirstRefreshWait = (feedId: string): void => {
  firstRefreshWait?.abort();
  const controller = new AbortController();
  firstRefreshWait = controller;
  void reloadAfterFirstRefresh(feedId, controller.signal);
};

export const retryLoad = async (): Promise<void> => {
  if (store.listBoundary() === null) {
    await loadScopeFirstPage(store.activeScope(), store.activeUnreadOnly());
    return;
  }

  await retryWindow();
};

/** `SP-ADD-1`: prepends a freshly created saved page into `/later`. */
export const insertSavedPageLocal = (page: SavedPage): void => {
  if (store.activeScope().kind !== 'later') return;

  const snapshot = beginRecordSnapshot();
  const inserted = store.prependRow(
    store.toLibraryArticle('later', page),
    snapshot.seq
  );
  snapshot.release();
  if (inserted && !page.read) sidebar.adjustSavedUnread(1);
  flush();
  startWindow();
};

/** `SP-REMOVE-1`: removes a deleted saved page from `/later`. */
export const removeSavedPageLocal = (pageId: string): void => {
  if (store.activeScope().kind !== 'later') return;

  const target = store.articleById(pageId);
  const existed = store.snapshotIds().includes(pageId);
  store.removeListIds([pageId]);
  if (existed && target?.read === false) sidebar.adjustSavedUnread(-1);
  flush();
  startWindow();
};

/** `FD-PREF-1`: changing order on the active single-feed list reloads its snapshot. */
export const changeFeedOrder = async (
  feed: Feed,
  order: SortOrder
): Promise<void> => {
  const token = feedOrderTokens.claim(feed.id);
  let current = false;
  try {
    await feedsApi.setOrder(feed.id, order);
    current = feedOrderTokens.isCurrent(feed.id, token);
  } catch (error) {
    if (feedOrderTokens.isCurrent(feed.id, token)) {
      showToast(errorText(error), 'error');
    }

    return;
  } finally {
    feedOrderTokens.release(feed.id, token);
  }

  if (!current) return;

  sidebar.updateFeedLocal(feed.id, { order });
  const scope = store.activeScope();
  if (scope.kind === 'feed' && scope.feedId === feed.id) {
    await loadScopeFirstPage(scope, store.activeUnreadOnly());
  }
};

export const clearLibraryState = (): void => {
  firstRefreshWait?.abort();
  firstRefreshWait = null;
  feedOrderTokens.reset();
  resetWindow();
};

onQueueDrained(store.trimRecordCache);
onSessionCleared(clearLibraryState);
