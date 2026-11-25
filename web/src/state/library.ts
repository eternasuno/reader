/**
 * Library list loading and local row mutations (`LIB-SCOPE-1`, `LIB-LIST-1`, `LIB-RELOAD-1`,
 * `LIB-FILTER-1`, `SP-ADD-1`, `FD-PREF-1`). Row actions live in `library-actions.ts` and are
 * re-exported here so `state/index.ts` keeps one public surface.
 */

import { flush } from 'solid-js';
import type { Feed, FeedItem, Page, SavedPage, SortOrder } from '../api';
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
import { LatestTokenMap } from './library-mutations';
import type { LibraryArticle, LibraryArticlePatch } from './library-store';
import * as store from './library-store';
import type { LibraryScope } from './scope';
import { hostnameOf } from './scope';
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
  activeOrder,
  activeScope,
  activeUnreadOnly,
  aggregateOrder,
  articleById,
  captureMutationVersion,
  cursor,
  isLibraryMounted,
  loadError,
  loadingInitial,
  loadingMore,
  PAGE_SIZE,
  retainReaderArticle,
  rows,
  trackLibraryMount,
  upsertArticle,
} from './library-store';

const feedOrderTokens = new LatestTokenMap();

export interface ArticleSource {
  title: string;
  url: string;
}

/**
 * `LIB-ROW-1`: saved pages are labelled by hostname, feed items by their feed. Read
 * reactively so rows loaded before the sidebar feeds still resolve.
 */
export const articleSource = (article: LibraryArticle): ArticleSource => {
  if (article.kind === 'later')
    return { title: hostnameOf(article.url), url: article.url };

  const feed = sidebar.feeds().find((entry) => entry.id === article.feedId);

  return { title: feed?.title ?? '', url: feed?.url ?? article.url };
};

const toLibraryArticle = (
  scope: LibraryScope,
  item: SavedPage | FeedItem
): LibraryArticle =>
  scope.kind === 'later'
    ? { ...(item as SavedPage), kind: 'later' }
    : { ...(item as FeedItem), kind: 'feed' };

const toRows = (
  scope: LibraryScope,
  items: ReadonlyArray<SavedPage | FeedItem>
): ReadonlyArray<LibraryArticle> =>
  items.map((item) => toLibraryArticle(scope, item));

interface PageRequest {
  scope: LibraryScope;
  unreadOnly: boolean;
  /** `undefined` lets the server apply the single feed's stored order (`FD-PREF-1`). */
  order: SortOrder | undefined;
  cursor: string | null;
}

const fetchPage = async (
  request: PageRequest
): Promise<Page<SavedPage> | Page<FeedItem>> => {
  const withOrder = {
    limit: store.PAGE_SIZE,
    unread: request.unreadOnly,
    cursor: request.cursor,
    order: request.order,
  };

  switch (request.scope.kind) {
    case 'later':
      return savedPagesApi.list(withOrder);
    case 'all':
      return feedItemsApi.listAll(withOrder);
    case 'feed':
      return feedsApi.listItems(request.scope.feedId, withOrder);
    case 'folder':
      return foldersApi.listItems(request.scope.folderId, withOrder);
  }
};

/** The default `newest` order is the server default, so only `oldest` is sent explicitly. */
const aggregateRequestOrder = (): SortOrder | undefined =>
  store.aggregateOrder() === 'oldest' ? 'oldest' : undefined;

const storedFeedOrder = (feedId: string): SortOrder | undefined =>
  sidebar.feeds().find((feed) => feed.id === feedId)?.order;

/** `FD-PREF-1`: a feed uses an explicit order, then its stored order; other lists use the shared one. */
const effectiveOrderOf = (
  scope: LibraryScope,
  order: SortOrder | undefined
): SortOrder => {
  if (scope.kind !== 'feed') return store.aggregateOrder();

  return order ?? storedFeedOrder(scope.feedId) ?? 'newest';
};

const resetListState = (
  scope: LibraryScope,
  unreadOnly: boolean,
  order: SortOrder
): void => {
  store.setActiveScope(scope);
  store.setActiveUnreadOnly(unreadOnly);
  store.setActiveOrder(order);
  store.clearRows();
  store.setCursor(null);
  store.setLoadError(null);
  store.setLoadingMore(false);
  store.setLoadingInitial(true);
  flush();
};

const finishInitialLoad = (requestGeneration: number): void => {
  if (requestGeneration !== store.requestState.generation) return;

  store.setLoadingInitial(false);
  flush();
};

/** `LIB-RELOAD-1`: loads page 1 for a scope, discarding any earlier in-flight response. */
export const loadScopeFirstPage = async (
  scope: LibraryScope,
  unreadOnly: boolean,
  order?: SortOrder
): Promise<void> => {
  store.requestState.generation += 1;
  store.requestState.pageInFlight = false;
  const requestGeneration = store.requestState.generation;
  const dispatchVersion = store.captureMutationVersion();
  // `FD-PREF-1`: without an explicit order the server applies a single feed's stored order.
  const requestOrder = scope.kind === 'feed' ? order : aggregateRequestOrder();

  resetListState(scope, unreadOnly, effectiveOrderOf(scope, order));

  try {
    const page = await fetchPage({
      scope,
      unreadOnly,
      order: requestOrder,
      cursor: null,
    });
    if (requestGeneration !== store.requestState.generation) return;

    store.replaceRows(toRows(scope, page.items), dispatchVersion);
    store.setCursor(page.cursor);
  } catch (error) {
    if (requestGeneration !== store.requestState.generation) return;

    store.setLoadError(errorCodeOf(error));
  } finally {
    finishInitialLoad(requestGeneration);
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

const canLoadNextPage = (nextCursor: string | null): boolean =>
  nextCursor !== null &&
  !store.loadingInitial() &&
  !store.loadingMore() &&
  store.loadError() === null &&
  !store.requestState.pageInFlight;

const finishNextPage = (requestGeneration: number): void => {
  if (requestGeneration !== store.requestState.generation) return;

  store.requestState.pageInFlight = false;
  store.setLoadingMore(false);
  flush();
};

/**
 * `LIB-LIST-1`: appends the next page (deduped by ID). At most one page request is in flight;
 * a failure keeps the loaded rows and exposes a retry banner through `loadError`.
 */
export const loadNextPage = async (): Promise<void> => {
  const nextCursor = store.cursor();
  if (!canLoadNextPage(nextCursor)) return;

  store.requestState.pageInFlight = true;
  const requestGeneration = store.requestState.generation;
  const dispatchVersion = store.captureMutationVersion();
  const scope = store.activeScope();
  const request: PageRequest = {
    scope,
    unreadOnly: store.activeUnreadOnly(),
    // `FD-PREF-1`: the server applies a single feed's stored order, so pagination stays consistent
    // even when the client has not loaded the feed list yet.
    order: scope.kind === 'feed' ? undefined : aggregateRequestOrder(),
    cursor: nextCursor,
  };

  store.setLoadingMore(true);
  flush();

  try {
    const page = await fetchPage(request);
    if (requestGeneration !== store.requestState.generation) return;

    store.appendRows(toRows(request.scope, page.items), dispatchVersion);
    store.setCursor(page.cursor);
  } catch (error) {
    if (requestGeneration !== store.requestState.generation) return;

    store.setLoadError(errorCodeOf(error));
  } finally {
    finishNextPage(requestGeneration);
  }
};

export const retryLoad = async (): Promise<void> => {
  if (store.rows().length === 0) {
    await loadScopeFirstPage(store.activeScope(), store.activeUnreadOnly());

    return;
  }

  store.setLoadError(null);
  flush();
  await loadNextPage();
};

const isFinalPageLoaded = (): boolean =>
  store.cursor() === null &&
  !store.loadingInitial() &&
  store.loadError() === null;

/**
 * `SP-ADD-1`: inserts a freshly created saved page into `/later` matching the active order:
 * newest-first prepends, oldest-first appends only when the final page is already loaded.
 */
export const insertSavedPageLocal = (page: SavedPage): void => {
  if (store.activeScope().kind !== 'later' || store.hasRow(page.id)) return;

  const article = toLibraryArticle({ kind: 'later' }, page);
  if (store.activeOrder() === 'newest') {
    store.prependRow(article);
  } else if (isFinalPageLoaded()) {
    store.appendRow(article);
  }

  if (!page.read) sidebar.adjustSavedUnread(1);

  flush();
};

/** `SP-REMOVE-1`: drops a deleted saved page from the loaded `/later` rows and its unread count. */
export const removeSavedPageLocal = (pageId: string): void => {
  const target = store.articleById(pageId);
  if (target === null || !store.hasRow(pageId)) return;

  store.removeRow(pageId);
  if (!target.read) sidebar.adjustSavedUnread(-1);

  flush();
};

/** Patches an article record in place (used by the reader after extraction, `RD-EXTRACT-1`). */
export const patchArticleLocal = (
  articleId: string,
  patch: LibraryArticlePatch
): void => {
  store.patchArticle(articleId, patch);
};

/** `FD-PREF-1`: changing order on the active single-feed list resets the cursor and reloads. */
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
    await loadScopeFirstPage(scope, store.activeUnreadOnly(), order);
  }
};

/** `FD-PREF-1`: flips the shared order of the all-feeds, folder, and read-later lists and reloads. */
export const toggleAggregateOrder = async (): Promise<void> => {
  store.setAggregateOrder(
    store.aggregateOrder() === 'oldest' ? 'newest' : 'oldest'
  );
  flush();

  const scope = store.activeScope();
  if (scope.kind !== 'feed') {
    await loadScopeFirstPage(scope, store.activeUnreadOnly());
  }
};

export const clearLibraryState = (): void => {
  firstRefreshWait?.abort();
  firstRefreshWait = null;
  feedOrderTokens.reset();
};

onSessionCleared(clearLibraryState);
