/**
 * Reader pane state: open article derived from the shared record store, display mode and
 * extraction (`RD-ARTICLE-1`, `RD-CONTENT-1`, `RD-EXTRACT-1`, `RD-MODE-1`, `RD-READ-1`,
 * `RD-NAV-1`, `RD-WEBPAGE-1`).
 */

import { createSignal, flush } from 'solid-js';
import type { ReaderMode } from '../api';
import { feedItemsApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { LibraryArticle } from './library';
import * as library from './library';
import { refreshArticleSnapshot } from './library-mark-all';
import { articleKindOf } from './library-store';
import type { ReadTarget } from './read-sync';
import { beginRecordSnapshot, targetOf } from './read-sync';
import { fetchArticle } from './read-sync-transport';
import { clearReaderSaveState } from './reader-save';
import type { LibraryScope } from './scope';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

const [openArticleId, setOpenArticleId] = createSignal<string | null>(null);
const [articleMissing, setArticleMissing] = createSignal(false);
const [loadingArticle, setLoadingArticle] = createSignal(false);
/** The current reader view: a stored starting mode or the temporary embedded webpage. */
export type DisplayMode = ReaderMode | 'embedded';

const [displayMode, setDisplayMode] = createSignal<DisplayMode>('default');
const [extracting, setExtracting] = createSignal(false);

export { saveFeedItemToLater } from './reader-save';
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

const isStale = (requestGeneration: number): boolean =>
  requestGeneration !== generation;

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
  const snapshot = beginRecordSnapshot();
  try {
    const loaded = await fetchArticle(articleKindOf(scope), articleId);
    if (isStale(requestGeneration)) return undefined;
    if (loaded === null) return null;

    library.upsertArticle(loaded, snapshot.seq);
    return loaded;
  } catch (error) {
    if (isStale(requestGeneration)) return undefined;

    setLoadingArticle(false);
    flush();
    showToast(errorText(error), 'error');
    return undefined;
  } finally {
    snapshot.release();
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

/** `RD-NAV-1`: prev/next step through the snapshot IDs; both are disabled when the article is not
 * part of it. */
export const adjacentArticleIds = (): {
  prevId: string | null;
  nextId: string | null;
} => {
  const ids = library.rowIds();
  const id = openArticleId();
  const index = id === null ? -1 : ids.indexOf(id);
  if (index < 0) return { prevId: null, nextId: null };

  return {
    prevId: ids[index - 1] ?? null,
    nextId: ids[index + 1] ?? null,
  };
};

/**
 * Re-fetches the open reader article when `covers` matches it, without resetting selection,
 * display mode, or auto-marking read.
 */
export const refreshOpenArticle = async (
  covers: (target: ReadTarget) => boolean,
  canCommit?: (seq: number) => boolean
): Promise<void> => {
  const current = openArticle();
  if (current === null || !covers(targetOf(current))) return;

  const reqGen = generation;
  await refreshArticleSnapshot(current.kind, current.id, (loaded, seq) => {
    const stale =
      isStale(reqGen) || openArticleId() !== current.id || articleMissing();
    if (stale || canCommit?.(seq) === false) return;

    if (loaded !== null) library.upsertArticle(loaded, seq);
    else {
      setArticleMissing(true);
      library.retainReaderArticle(null);
    }
    flush();
  });
};

export const clearReaderState = (): void => {
  generation += 1;
  clearReaderSaveState();
  clearOpenArticle();
};

onSessionCleared(clearReaderState);
