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
import type { QueueEntry } from './library-queue';
import * as queue from './library-queue';
import type { LibraryArticle } from './library-store';
import * as store from './library-store';
import { beginRecordSnapshot } from './read-sync';
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
  groupStartIds,
  isLibraryMounted,
  listBoundary,
  loadError,
  loadingInitial,
  loadingMore,
  /** Patches an article record in place (used by the reader after extraction, `RD-EXTRACT-1`). */
  patchArticle as patchArticleLocal,
  retainReaderArticle,
  rowIds,
  rows,
  trackLibraryMount,
  upsertArticle,
} from './library-store';

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

const fetchQueue = async (
  scope: LibraryScope,
  unread: boolean
): Promise<{
  boundary: string;
  entries: Array<QueueEntry>;
}> => {
  if (scope.kind === 'later') {
    const { boundary, ids } = await savedPagesApi.order({ unread });
    return { boundary, entries: ids.map((id) => ({ id, groupStart: false })) };
  }

  const { boundary, groups } = await fetchFeedOrder(scope, unread);
  return {
    boundary,
    entries: groups.flatMap(({ feedId, ids }) =>
      ids.map((id, index) => ({ id, feedId, groupStart: index === 0 }))
    ),
  };
};

const isCurrent = (generation: number): boolean =>
  store.requestState.generation === generation;

const loadChunk = async (
  scope: LibraryScope,
  chunk: Array<QueueEntry>,
  generation: number
): Promise<boolean> => {
  const ids = chunk.map(({ id }) => id);
  const snapshot = beginRecordSnapshot();
  try {
    const { items } = await (scope.kind === 'later'
      ? savedPagesApi.byIds(ids)
      : feedItemsApi.byIds(ids));
    if (!isCurrent(generation)) return false;

    const byId = new Map(items.map((item) => [item.id, item]));
    const visible: Array<LibraryArticle> = [];
    for (const entry of chunk) {
      if (!queue.isQueued(scope, entry)) continue;

      queue.consumeQueuedId(entry.id);
      const item = byId.get(entry.id);
      if (item !== undefined) {
        visible.push(store.toLibraryArticle(store.articleKindOf(scope), item));
      }
    }
    if (visible.length === 0) return false;

    store.appendRows(visible, snapshot.seq);
    return true;
  } finally {
    snapshot.release();
  }
};
const consumeChunks = async (
  scope: LibraryScope,
  generation: number,
  first: Array<QueueEntry>
): Promise<void> => {
  let chunk = first;
  while (isCurrent(generation) && chunk.length > 0) {
    if ((await loadChunk(scope, chunk, generation)) || !isCurrent(generation))
      return;

    chunk = queue.nextChunk(scope);
  }
};
const loadChunks = async (
  scope: LibraryScope,
  generation: number,
  initial: boolean
): Promise<void> => {
  if (store.requestState.batchInFlight) return;

  store.requestState.batchInFlight = true;
  try {
    const chunk = queue.nextChunk(scope);
    if (chunk.length === 0) return;

    if (!initial) store.setLoadingMore(true);
    flush();
    await consumeChunks(scope, generation, chunk);
  } catch (error) {
    if (isCurrent(generation)) store.setLoadError(errorCodeOf(error));
  } finally {
    if (isCurrent(generation)) {
      store.requestState.batchInFlight = false;
      (initial ? store.setLoadingInitial : store.setLoadingMore)(false);
      flush();
    }
  }
};

/** `LIB-RELOAD-1`: loads a fresh snapshot and discards earlier in-flight responses. */
export const loadScopeFirstPage = async (
  scope: LibraryScope,
  unreadOnly: boolean
): Promise<void> => {
  const generation = ++store.requestState.generation;
  store.requestState.batchInFlight = false;
  store.setActiveScope(scope);
  store.setActiveUnreadOnly(unreadOnly);
  store.clearRows();
  queue.resetQueue();
  store.setListBoundary(null);
  store.setLoadError(null);
  store.setLoadingMore(false);
  store.setLoadingInitial(true);
  flush();

  if (scope.kind === 'folder') {
    for (const [feedId, folderId] of feedMoveTracker.pendingFolders()) {
      store.updateFolderMembership(feedId, folderId);
    }
  }

  try {
    const { boundary, entries } = await fetchQueue(scope, unreadOnly);
    if (!isCurrent(generation)) return;

    queue.acceptQueue(entries);
    store.setListBoundary(boundary);
    await loadChunks(scope, generation, true);
  } catch (error) {
    if (!isCurrent(generation)) return;

    store.setLoadError(errorCodeOf(error));
    store.setLoadingInitial(false);
    flush();
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

export const loadMore = async (): Promise<void> => {
  if (store.loadingInitial() || store.loadError() !== null) return;
  await loadChunks(store.activeScope(), store.requestState.generation, false);
};

export const resumeEmptyList = async (): Promise<void> => {
  if (store.rowIds().length === 0) await loadMore();
};

export const retryLoad = async (): Promise<void> => {
  if (store.listBoundary() === null) {
    await loadScopeFirstPage(store.activeScope(), store.activeUnreadOnly());
    return;
  }

  store.setLoadError(null);
  flush();
  await loadMore();
};

/** `SP-ADD-1`: prepends a freshly created saved page into `/later`. */
export const insertSavedPageLocal = (page: SavedPage): void => {
  if (store.activeScope().kind !== 'later' || store.hasRow(page.id)) return;

  queue.removeQueuedId(page.id);
  store.prependRow(store.toLibraryArticle('later', page));
  if (!page.read) sidebar.adjustSavedUnread(1);
  flush();
};

/** `SP-REMOVE-1`: drops a deleted saved page from the loaded and queued `/later` rows. */
export const removeSavedPageLocal = (pageId: string): void => {
  if (store.activeScope().kind !== 'later') return;

  const target = store.articleById(pageId);
  queue.removeQueuedId(pageId);
  store.removeRow(pageId);
  if (target?.read === false) sidebar.adjustSavedUnread(-1);
  flush();
  void resumeEmptyList();
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
};

onSessionCleared(clearLibraryState);
