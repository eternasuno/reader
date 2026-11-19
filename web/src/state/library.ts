/**
 * Library list loading and local row patches (`LIB-SCOPE-1`, `LIB-LIST-1`, `LIB-RELOAD-1`,
 * `LIB-FILTER-1`, `SP-ADD-1`, `FD-PREF-1`). Row actions live in `library-actions.ts` and are
 * re-exported here so `state/index.ts` keeps one public surface.
 */

import { flush } from 'solid-js';
import type { Feed, FeedItem, Page, SavedPage, SortOrder } from '../api';
import {
  ApiError,
  feedItemsApi,
  feedsApi,
  foldersApi,
  savedPagesApi,
} from '../api';
import { translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import type { LibraryArticle, LibraryArticlePatch } from './library-store';
import {
  activeScope,
  activeUnreadOnly,
  cursor,
  loadError,
  loadingInitial,
  loadingMore,
  notifyArticlePatched,
  PAGE_SIZE,
  requestState,
  rows,
  setActiveOrder,
  setActiveScope,
  setActiveUnreadOnly,
  setCursor,
  setLoadError,
  setLoadingInitial,
  setLoadingMore,
  setRows,
} from './library-store';
import type { LibraryScope } from './scope';
import { hostnameOf } from './scope';
import * as sidebar from './sidebar';

export * from './library-actions';
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
  cursor,
  loadError,
  loadingInitial,
  loadingMore,
  PAGE_SIZE,
  rows,
  setOnArticlePatched,
} from './library-store';

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

const feedTitle = (feedId: string): string =>
  sidebar.feeds().find((feed) => feed.id === feedId)?.title ?? '';

const toLibraryArticle = (
  scope: LibraryScope,
  item: SavedPage | FeedItem
): LibraryArticle =>
  scope.kind === 'later'
    ? {
        ...(item as SavedPage),
        kind: 'later',
        sourceTitle: hostnameOf(item.url),
      }
    : {
        ...(item as FeedItem),
        kind: 'feed',
        sourceTitle: feedTitle((item as FeedItem).feedId),
      };

const toRows = (
  scope: LibraryScope,
  items: ReadonlyArray<SavedPage | FeedItem>
): ReadonlyArray<LibraryArticle> =>
  items.map((item) => toLibraryArticle(scope, item));

interface PageRequest {
  scope: LibraryScope;
  unreadOnly: boolean;
  /** `undefined` lets the server apply the feed's stored order (`FD-PREF-1`). */
  order: SortOrder | undefined;
  cursor: string | null;
}

const fetchPage = async (
  request: PageRequest
): Promise<Page<SavedPage> | Page<FeedItem>> => {
  const params = {
    limit: PAGE_SIZE,
    unread: request.unreadOnly,
    cursor: request.cursor,
  };

  switch (request.scope.kind) {
    case 'later':
      return savedPagesApi.list(params);
    case 'all':
      return feedItemsApi.listAll(params);
    case 'feed':
      return feedsApi.listItems(request.scope.feedId, {
        ...params,
        order: request.order,
      });
    case 'folder':
      return foldersApi.listItems(request.scope.folderId, params);
  }
};

const storedFeedOrder = (feedId: string): SortOrder | undefined =>
  sidebar.feeds().find((feed) => feed.id === feedId)?.order;

/** `FD-PREF-1`: an explicit order wins, then the feed's stored order, then `newest`. */
const effectiveOrderOf = (
  scope: LibraryScope,
  order: SortOrder | undefined
): SortOrder => {
  if (scope.kind !== 'feed') return 'newest';
  return order ?? storedFeedOrder(scope.feedId) ?? 'newest';
};

const resetListState = (
  scope: LibraryScope,
  unreadOnly: boolean,
  order: SortOrder
): void => {
  setActiveScope(scope);
  setActiveUnreadOnly(unreadOnly);
  setActiveOrder(order);
  setRows([]);
  setCursor(null);
  setLoadError(null);
  setLoadingMore(false);
  setLoadingInitial(true);
  flush();
};

const finishInitialLoad = (requestGeneration: number): void => {
  if (requestGeneration !== requestState.generation) return;

  setLoadingInitial(false);
  flush();
};

/** `LIB-RELOAD-1`: loads page 1 for a scope, discarding any earlier in-flight response. */
export const loadScopeFirstPage = async (
  scope: LibraryScope,
  unreadOnly: boolean,
  order?: SortOrder
): Promise<void> => {
  requestState.generation += 1;
  const requestGeneration = requestState.generation;
  // `FD-PREF-1`: without an explicit order the server applies the feed's stored order.
  const requestOrder = scope.kind === 'feed' ? order : undefined;

  resetListState(scope, unreadOnly, effectiveOrderOf(scope, order));

  try {
    const page = await fetchPage({
      scope,
      unreadOnly,
      order: requestOrder,
      cursor: null,
    });
    if (requestGeneration !== requestState.generation) return;

    setRows(toRows(scope, page.items));
    setCursor(page.cursor);
  } catch (error) {
    if (requestGeneration !== requestState.generation) return;
    setLoadError(codeOf(error));
  } finally {
    finishInitialLoad(requestGeneration);
  }
};

const canLoadNextPage = (nextCursor: string | null): boolean =>
  nextCursor !== null &&
  !loadingInitial() &&
  !loadingMore() &&
  loadError() === null &&
  !requestState.pageInFlight;

const finishNextPage = (requestGeneration: number): void => {
  requestState.pageInFlight = false;
  if (requestGeneration !== requestState.generation) return;

  setLoadingMore(false);
  flush();
};

/**
 * `LIB-LIST-1`: appends the next page. At most one page request is in flight; a failure keeps the
 * loaded rows and exposes a retry banner through `loadError`.
 */
export const loadNextPage = async (): Promise<void> => {
  const nextCursor = cursor();
  if (!canLoadNextPage(nextCursor)) return;

  requestState.pageInFlight = true;
  const requestGeneration = requestState.generation;
  const request: PageRequest = {
    scope: activeScope(),
    unreadOnly: activeUnreadOnly(),
    // `FD-PREF-1`: the server applies the feed's stored order, so pagination stays consistent even
    // when the client has not loaded the feed list yet.
    order: undefined,
    cursor: nextCursor,
  };

  setLoadingMore(true);
  flush();

  try {
    const page = await fetchPage(request);
    if (requestGeneration !== requestState.generation) return;

    setRows([...rows(), ...toRows(request.scope, page.items)]);
    setCursor(page.cursor);
  } catch (error) {
    if (requestGeneration !== requestState.generation) return;
    setLoadError(codeOf(error));
  } finally {
    finishNextPage(requestGeneration);
  }
};

export const retryLoad = async (): Promise<void> => {
  if (rows().length === 0) {
    await loadScopeFirstPage(activeScope(), activeUnreadOnly());
    return;
  }

  setLoadError(null);
  flush();
  await loadNextPage();
};

/** `SP-ADD-1`: inserts a freshly created saved page at the top of the loaded `/later` list. */
export const prependSavedPageLocal = (page: SavedPage): void => {
  if (activeScope().kind !== 'later') return;

  const article = toLibraryArticle({ kind: 'later' }, page);
  if (rows().some((row) => row.id === article.id)) return;

  setRows((current) => [article, ...current]);
  if (!page.read) sidebar.adjustSavedUnread(1);
  flush();
};

/** `later.md:18`: drops a deleted saved page from the loaded `/later` rows and its unread count. */
export const removeSavedPageLocal = (pageId: string): void => {
  const target = rows().find((row) => row.id === pageId) ?? null;
  if (target === null) return;

  setRows((current) => current.filter((row) => row.id !== pageId));
  if (!target.read) sidebar.adjustSavedUnread(-1);
  flush();
};

/** Patches a loaded row in place (used by the reader after extraction, `RD-EXTRACT-1`). */
export const patchArticleLocal = (
  articleId: string,
  patch: LibraryArticlePatch
): void => {
  setRows((current) =>
    current.map((row) =>
      row.id === articleId ? ({ ...row, ...patch } as LibraryArticle) : row
    )
  );
  notifyArticlePatched(articleId, patch);
};

/** `FD-PREF-1`: changing order on the active single-feed list resets the cursor and reloads. */
export const changeFeedOrder = async (
  feed: Feed,
  order: SortOrder
): Promise<void> => {
  try {
    await feedsApi.setOrder(feed.id, order);
  } catch (error) {
    showToast(translateErrorCode(codeOf(error)), 'error');
    return;
  }

  sidebar.updateFeedLocal(feed.id, { order });
  const scope = activeScope();
  if (scope.kind === 'feed' && scope.feedId === feed.id) {
    await loadScopeFirstPage(scope, activeUnreadOnly(), order);
  }
};
