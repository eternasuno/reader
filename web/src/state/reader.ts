/**
 * Reader pane state: open article derived from the shared record store, display mode and
 * extraction (`RD-ARTICLE-1`, `RD-CONTENT-1`, `RD-EXTRACT-1`, `RD-MODE-1`, `RD-READ-1`,
 * `RD-NAV-1`, `RD-WEBPAGE-1`).
 */

import { createSignal, flush } from 'solid-js';
import type { FeedItem, ReaderMode, SavedPage } from '../api';
import { ApiError, feedItemsApi, savedPagesApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { LibraryArticle } from './library';
import * as library from './library';
import { beginRecordSnapshot } from './read-sync';
import type { LibraryScope } from './scope';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

const [openArticleId, setOpenArticleId] = createSignal<string | null>(null);
const [articleMissing, setArticleMissing] = createSignal(false);
const [loadingArticle, setLoadingArticle] = createSignal(false);
const [displayMode, setDisplayMode] = createSignal<ReaderMode>('default');
const [extracting, setExtracting] = createSignal(false);

export { displayMode, extracting, loadingArticle, openArticleId };

/** Derived from the single article record store; no separate copy or cross-store listener. */
export const openArticle = (): LibraryArticle | null => {
  const id = openArticleId();
  if (id === null || articleMissing()) return null;

  return library.articleById(id);
};

/** `RD-ARTICLE-1`: latest navigation always wins; stale responses are discarded. */
let generation = 0;
/** Preserves manual mode changes made while initial feed preferences are still resolving. */
let modeTouched = false;
let extractToken = 0;
let inFlightExtract: {
  articleId: string;
  generation: number;
  token: number;
} | null = null;
const savingToLaterIds = new Set<string>();
let saveEpoch = 0;

const isStale = (requestGeneration: number): boolean =>
  requestGeneration !== generation;

const toLibraryArticle = (
  scope: LibraryScope,
  item: SavedPage | FeedItem
): LibraryArticle =>
  scope.kind === 'later'
    ? { ...(item as SavedPage), kind: 'later' }
    : { ...(item as FeedItem), kind: 'feed' };

const hasKnownFeed = (article: LibraryArticle | null): boolean =>
  article !== null &&
  article.kind === 'feed' &&
  sidebar.feeds().some((feed) => feed.id === article.feedId);

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
  modeTouched = false;
  inFlightExtract = null;
  setOpenArticleId(null);
  setArticleMissing(false);
  setLoadingArticle(false);
  setExtracting(false);
  setDisplayMode('default');
  library.retainReaderArticle(null);
  flush();
};

const showOpeningState = (
  scope: LibraryScope,
  articleId: string,
  cached: LibraryArticle | null,
  canCommitCached: boolean
): void => {
  inFlightExtract = null;
  setOpenArticleId(articleId);
  setArticleMissing(false);
  setExtracting(false);
  setDisplayMode(canCommitCached ? startingMode(scope, cached) : 'default');
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
 * so the caller stops; `null` means the article does not exist anymore. A loaded article is
 * merged into the record store while its snapshot is still tracked by the read sync.
 */
const loadArticle = async (
  scope: LibraryScope,
  articleId: string,
  requestGeneration: number
): Promise<LibraryArticle | null | undefined> => {
  const releaseSnapshot = beginRecordSnapshot();
  try {
    const remote = await fetchRemoteArticle(scope, articleId);
    if (isStale(requestGeneration)) return undefined;
    if (remote === null) return null;

    const loaded = toLibraryArticle(scope, remote);
    library.upsertArticle(loaded);
    return loaded;
  } catch (error) {
    if (isStale(requestGeneration)) return undefined;

    setLoadingArticle(false);
    flush();
    showToast(errorText(error), 'error');
    return undefined;
  } finally {
    releaseSnapshot();
  }
};

/** `RD-READ-1`: toggles or sets read state with the article's kind/feed fallback. */
export const toggleOpenArticleRead = async (
  article: LibraryArticle,
  nextRead: boolean
): Promise<void> => {
  await library.toggleArticleRead(article.id, nextRead, {
    kind: article.kind,
    feedId: article.kind === 'feed' ? article.feedId : null,
    read: article.read,
  });
};

const markOpenedRead = async (article: LibraryArticle): Promise<void> => {
  if (article.read) return;

  await toggleOpenArticleRead(article, true);
};

const resolveInitialMode = async (
  scope: LibraryScope,
  article: LibraryArticle,
  requestGeneration: number,
  alreadyCommitted: boolean
): Promise<ReaderMode | null> => {
  if (modeTouched) return null;
  if (alreadyCommitted) return startingMode(scope, article);

  if (
    scope.kind !== 'later' &&
    article.kind === 'feed' &&
    !hasKnownFeed(article)
  ) {
    await sidebar.ensureFeeds();
    if (isStale(requestGeneration) || modeTouched) return null;
  }

  const mode = startingMode(scope, article);
  setDisplayMode(mode);
  flush();
  return mode;
};

const shouldAutoExtract = (
  mode: ReaderMode | null,
  article: LibraryArticle
): boolean =>
  !modeTouched &&
  mode === 'extracted' &&
  article.kind === 'feed' &&
  !article.extractedContent;

export const openArticleByRoute = async (
  scope: LibraryScope,
  articleId: string | null
): Promise<void> => {
  generation += 1;
  const requestGeneration = generation;
  modeTouched = false;

  if (articleId === null) {
    clearOpenArticle();
    return;
  }

  library.retainReaderArticle(articleId);
  const cached = library.articleById(articleId);
  const canCommitCached =
    cached !== null && (cached.kind === 'later' || hasKnownFeed(cached));
  showOpeningState(scope, articleId, cached, canCommitCached);

  const loaded = await loadArticle(scope, articleId, requestGeneration);
  if (loaded === undefined) return;

  if (loaded === null) {
    // `RD-ARTICLE-1`: an unknown/deleted id renders the empty reader without an error toast.
    setArticleMissing(true);
    setLoadingArticle(false);
    library.retainReaderArticle(null);
    flush();
    return;
  }

  setLoadingArticle(false);
  flush();

  const current = library.articleById(loaded.id) ?? loaded;
  const readPromise = markOpenedRead(current);
  const mode = await resolveInitialMode(
    scope,
    current,
    requestGeneration,
    canCommitCached
  );
  await readPromise;
  if (isStale(requestGeneration)) return;

  if (shouldAutoExtract(mode, current)) await extractCurrentFeedItem();
};

const shouldExtractCurrent = (article: LibraryArticle | null): boolean =>
  article !== null && article.kind === 'feed' && !article.extractedContent;

const showSaveError = (error: unknown): void => {
  if (error instanceof ApiError && error.code === 'SavedPageAlreadyExists') {
    showToast(t('errors.SavedPageAlreadyExists'), 'info');

    return;
  }

  showToast(errorText(error), 'error');
};

/** `later.md:17` / `SP-ADD-1`: saves a feed item to Read Later once per concurrent request. */
export const saveFeedItemToLater = async (articleId: string): Promise<void> => {
  if (savingToLaterIds.has(articleId)) return;

  const requestEpoch = saveEpoch;
  savingToLaterIds.add(articleId);
  try {
    await savedPagesApi.saveFeedItem(articleId);
    if (requestEpoch !== saveEpoch) return;

    showToast(t('later.savedFromFeedToast'), 'success');
    void sidebar.refreshSidebar();
  } catch (error) {
    if (requestEpoch === saveEpoch) showSaveError(error);
  } finally {
    if (requestEpoch === saveEpoch) savingToLaterIds.delete(articleId);
  }
};

/** `RD-EXTRACT-1`: toggles the extracted view, extracting the open feed item when needed. */
export const toggleExtractedMode = async (): Promise<void> => {
  modeTouched = true;
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
  modeTouched = true;
  setDisplayMode((mode) => (mode === 'embedded' ? 'default' : 'embedded'));
  flush();
};

const isActiveExtraction = (
  requestGeneration: number,
  token: number
): boolean =>
  requestGeneration === generation && inFlightExtract?.token === token;

const beginExtraction = (articleId: string): number | null => {
  if (
    inFlightExtract?.articleId === articleId &&
    inFlightExtract.generation === generation
  ) {
    return null;
  }

  extractToken += 1;
  inFlightExtract = { articleId, generation, token: extractToken };
  setExtracting(true);
  flush();

  return extractToken;
};

const finishExtraction = (requestGeneration: number, token: number): void => {
  if (inFlightExtract?.token !== token) return;

  inFlightExtract = null;
  if (requestGeneration === generation) {
    setExtracting(false);
    flush();
  }
};

export const extractCurrentFeedItem = async (): Promise<void> => {
  const article = openArticle();
  if (article === null || article.kind !== 'feed') return;

  const requestGeneration = generation;
  const token = beginExtraction(article.id);
  if (token === null) return;

  try {
    const updated = await feedItemsApi.extract(article.id);
    if (!isActiveExtraction(requestGeneration, token)) return;

    library.patchArticleLocal(article.id, {
      extractedContent: updated.extractedContent,
    });
  } catch (error) {
    if (!isActiveExtraction(requestGeneration, token)) return;

    if (displayMode() === 'extracted') setDisplayMode('default');
    showToast(errorText(error), 'error');
  } finally {
    finishExtraction(requestGeneration, token);
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

export const clearReaderState = (): void => {
  generation += 1;
  saveEpoch += 1;
  savingToLaterIds.clear();
  clearOpenArticle();
};

onSessionCleared(clearReaderState);
