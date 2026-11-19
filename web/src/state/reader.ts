/**
 * Reader pane state: open article, display mode and extraction (`RD-ARTICLE-1`, `RD-CONTENT-1`,
 * `RD-EXTRACT-1`, `RD-MODE-1`, `RD-READ-1`, `RD-NAV-1`, `RD-WEBPAGE-1`).
 */

import { createSignal, flush } from 'solid-js';
import type { FeedItem, ReaderMode, SavedPage } from '../api';
import { ApiError, feedItemsApi, savedPagesApi } from '../api';
import { translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import type { LibraryArticle } from './library';
import * as library from './library';
import type { LibraryScope } from './scope';
import { hostnameOf } from './scope';
import * as sidebar from './sidebar';

const [openArticleId, setOpenArticleId] = createSignal<string | null>(null);
const [openArticle, setOpenArticle] = createSignal<LibraryArticle | null>(null);
const [loadingArticle, setLoadingArticle] = createSignal(false);
const [displayMode, setDisplayMode] = createSignal<ReaderMode>('default');
const [extracting, setExtracting] = createSignal(false);

export { displayMode, extracting, loadingArticle, openArticle, openArticleId };

// `LIB-READ-1` / `RD-READ-1`: keep the open article in sync with optimistic row read patches.
library.setOnArticlePatched((articleId, patch) => {
  const current = openArticle();
  if (current === null || current.id !== articleId) return;

  setOpenArticle({ ...current, ...patch } as LibraryArticle);
  flush();
});

/** `RD-ARTICLE-1`: latest navigation always wins; stale responses are discarded. */
let generation = 0;

const isStale = (requestGeneration: number): boolean =>
  requestGeneration !== generation;

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

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
        sourceTitle:
          sidebar.feeds().find((feed) => feed.id === (item as FeedItem).feedId)
            ?.title ?? '',
      };

/**
 * `RD-MODE-1`: saved pages start in `default`; feed items start in their feed's stored mode.
 */
const startingMode = (
  scope: LibraryScope,
  article: LibraryArticle | null
): ReaderMode => {
  if (scope.kind === 'later') return 'default';
  if (article === null || article.kind === 'later') return 'default';

  return (
    sidebar.feeds().find((feed) => feed.id === article.feedId)?.readerMode ??
    'default'
  );
};

const clearOpenArticle = (): void => {
  setOpenArticleId(null);
  setOpenArticle(null);
  setLoadingArticle(false);
  setExtracting(false);
  setDisplayMode('default');
  flush();
};

/** Renders the cached row (when the id is part of the loaded list) while the remote load runs. */
const showCachedArticle = (
  scope: LibraryScope,
  articleId: string,
  cached: LibraryArticle | null
): void => {
  setOpenArticleId(articleId);
  setOpenArticle(cached);
  setExtracting(false);
  setDisplayMode(startingMode(scope, cached));
  setLoadingArticle(true);
  flush();
};

const fetchRemoteArticle = async (
  scope: LibraryScope,
  articleId: string
): Promise<SavedPage | FeedItem | null> =>
  scope.kind === 'later'
    ? savedPagesApi.getById(articleId)
    : feedItemsApi.getById(articleId);

/**
 * `RD-ARTICLE-1`: `undefined` means a newer navigation won or the load failed (already toasted),
 * so the caller stops; `null` means the article does not exist anymore.
 */
const loadArticle = async (
  scope: LibraryScope,
  articleId: string,
  requestGeneration: number
): Promise<LibraryArticle | null | undefined> => {
  try {
    const remote = await fetchRemoteArticle(scope, articleId);
    if (isStale(requestGeneration)) return undefined;

    return remote === null ? null : toLibraryArticle(scope, remote);
  } catch (error) {
    if (isStale(requestGeneration)) return undefined;

    setLoadingArticle(false);
    flush();
    showToast(translateErrorCode(codeOf(error)), 'error');
    return undefined;
  }
};

const applyLoadedArticle = (
  scope: LibraryScope,
  cached: LibraryArticle | null,
  loaded: LibraryArticle | null
): void => {
  if (loaded === null) {
    // `RD-ARTICLE-1`: an unknown/deleted id renders the empty reader without an error toast.
    setOpenArticle(null);
    setLoadingArticle(false);
    flush();
    return;
  }

  setOpenArticle(loaded);
  if (cached === null) setDisplayMode(startingMode(scope, loaded));
  setLoadingArticle(false);
  flush();
};

const markOpenedRead = async (article: LibraryArticle): Promise<void> => {
  // `RD-READ-1`: opening an unread article optimistically marks it read. The fallback lets
  // deep-linked articles outside the loaded rows adjust unread counts and the open state.
  if (article.read) return;

  await library.toggleArticleRead(article.id, true, {
    kind: article.kind,
    feedId: article.kind === 'feed' ? article.feedId : null,
    read: article.read,
  });
};

/** `RD-MODE-1` / `RD-EXTRACT-1`: a feed starting in `extracted` extracts when uncached. */
const shouldAutoExtract = (
  scope: LibraryScope,
  article: LibraryArticle
): boolean =>
  startingMode(scope, article) === 'extracted' &&
  article.kind === 'feed' &&
  !article.extractedContent;

export const openArticleByRoute = async (
  scope: LibraryScope,
  articleId: string | null
): Promise<void> => {
  generation += 1;
  const requestGeneration = generation;

  if (articleId === null) {
    clearOpenArticle();
    return;
  }

  const cached = library.rows().find((row) => row.id === articleId) ?? null;
  showCachedArticle(scope, articleId, cached);

  const loaded = await loadArticle(scope, articleId, requestGeneration);
  if (loaded === undefined) return;

  applyLoadedArticle(scope, cached, loaded);
  if (loaded === null) return;

  await markOpenedRead(loaded);
  if (isStale(requestGeneration)) return;

  if (shouldAutoExtract(scope, loaded)) await extractCurrentFeedItem();
};

/** `RD-EXTRACT-1`: toggles the extracted view, extracting the open feed item when needed. */
export const toggleExtractedMode = async (): Promise<void> => {
  if (displayMode() === 'extracted') {
    setDisplayMode('default');
    flush();
    return;
  }

  setDisplayMode('extracted');
  flush();

  if (shouldExtractCurrent(openArticle())) await extractCurrentFeedItem();
};

/** `RD-WEBPAGE-1`: toggles the embedded external-page view. */
export const toggleEmbeddedMode = (): void => {
  setDisplayMode((mode) => (mode === 'embedded' ? 'default' : 'embedded'));
  flush();
};

const shouldExtractCurrent = (article: LibraryArticle | null): boolean =>
  article !== null && article.kind === 'feed' && !article.extractedContent;

const applyExtractedContent = (
  articleId: string,
  extractedContent: string | undefined
): void => {
  const current = openArticle();
  if (current !== null && current.kind === 'feed' && current.id === articleId) {
    setOpenArticle({ ...current, extractedContent });
  }
  library.patchArticleLocal(articleId, { extractedContent });
};

export const extractCurrentFeedItem = async (): Promise<void> => {
  const article = openArticle();
  if (article === null || article.kind !== 'feed') return;

  const requestGeneration = generation;
  setExtracting(true);
  flush();

  try {
    const updated = await feedItemsApi.extract(article.id);
    if (requestGeneration !== generation) return;

    applyExtractedContent(article.id, updated.extractedContent);
  } catch (error) {
    if (requestGeneration !== generation) return;

    setDisplayMode('default');
    showToast(translateErrorCode(codeOf(error)), 'error');
  } finally {
    if (requestGeneration === generation) {
      setExtracting(false);
      flush();
    }
  }
};

/** `RD-NAV-1`: prev/next step through the loaded list; both are disabled when the article is not
 * part of it. */
export const adjacentArticleIds = (): {
  prevId: string | null;
  nextId: string | null;
} => {
  const currentRows = library.rows();
  const index = currentRows.findIndex((row) => row.id === openArticleId());
  if (index < 0) return { prevId: null, nextId: null };

  return {
    prevId: index > 0 ? currentRows[index - 1].id : null,
    nextId: index < currentRows.length - 1 ? currentRows[index + 1].id : null,
  };
};
