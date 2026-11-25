/**
 * Single-article optimistic read toggle (`LIB-READ-1`, `LIB-FILTER-1`). Tracks per-article
 * mutation ownership so a late failure never undoes a newer choice.
 */

import { flush } from 'solid-js';
import { feedItemsApi, savedPagesApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import { readTracker } from './library-mutations';
import type { ArticleReadFallback, LibraryArticle } from './library-store';
import {
  activeScope,
  articleById,
  hasRow,
  patchArticle,
  requestState,
} from './library-store';
import * as sidebar from './sidebar';

const adjustUnread = (
  kind: LibraryArticle['kind'],
  feedId: string | null,
  delta: number
): void => {
  if (kind === 'later') {
    sidebar.adjustSavedUnread(delta);
    return;
  }

  if (feedId !== null) sidebar.adjustFeedUnread(feedId, delta);
};

const rowKindOf = (
  article: LibraryArticle | null,
  fallback: ArticleReadFallback | undefined
): LibraryArticle['kind'] => {
  if (article !== null) return article.kind;
  if (fallback !== undefined) return fallback.kind;

  return activeScope().kind === 'later' ? 'later' : 'feed';
};

const rowFeedIdOf = (
  article: LibraryArticle | null,
  fallback: ArticleReadFallback | undefined
): string | null => {
  if (article !== null) return article.kind === 'feed' ? article.feedId : null;
  if (fallback === undefined || fallback.kind !== 'feed') return null;

  return fallback.feedId ?? null;
};

const setReadRequest = async (
  kind: LibraryArticle['kind'],
  articleId: string,
  read: boolean
): Promise<void> => {
  if (kind === 'later') {
    await savedPagesApi.setRead(articleId, read);
    return;
  }

  await feedItemsApi.setRead(articleId, read);
};

const isReadUnchanged = (
  existing: LibraryArticle | null,
  nextRead: boolean,
  fallback: ArticleReadFallback | undefined
): boolean => {
  if (existing !== null) return existing.read === nextRead;
  return fallback !== undefined && fallback.read === nextRead;
};

const beginOptimisticRead = (
  articleId: string,
  existing: LibraryArticle | null,
  nextRead: boolean,
  kind: LibraryArticle['kind'],
  feedId: string | null,
  previousRead: boolean | undefined
): number | undefined => {
  if (previousRead === undefined) return undefined;

  const token = readTracker.begin(articleId, previousRead, nextRead);
  if (existing !== null) patchArticle(articleId, { read: nextRead });
  adjustUnread(kind, feedId, nextRead ? -1 : 1);
  flush();
  return token;
};

const reconcileArticleRead = (
  articleId: string,
  targetRead: boolean,
  kind: LibraryArticle['kind'],
  feedId: string | null,
  startGeneration: number
): void => {
  const current = articleById(articleId);
  if (current === null) return;
  if (hasRow(articleId) && requestState.generation !== startGeneration) return;
  if (current.read === targetRead) return;

  adjustUnread(kind, feedId, targetRead ? -1 : 1);
  patchArticle(articleId, { read: targetRead });
  flush();
};

const handleReadFailure = async (
  error: unknown,
  articleId: string,
  token: number | undefined,
  kind: LibraryArticle['kind'],
  feedId: string | null,
  startGeneration: number
): Promise<void> => {
  if (token !== undefined) {
    const result = readTracker.fail(articleId, token);
    if (result !== null) {
      reconcileArticleRead(
        articleId,
        result.targetRead,
        kind,
        feedId,
        startGeneration
      );
      if (!result.owns) return;
      if (result.settledAll) await sidebar.invalidateSidebar();
    }
  } else {
    await sidebar.invalidateSidebar();
  }

  showToast(errorText(error), 'error');
};

/**
 * `LIB-FILTER-1` / `LIB-READ-1`: flips read state optimistically. Rows never leave the loaded list,
 * and the action is never gated by in-flight flags. `fallback` carries context when an article is
 * not yet in the record store.
 */
export const toggleArticleRead = async (
  articleId: string,
  nextRead: boolean,
  fallback?: ArticleReadFallback
): Promise<boolean> => {
  const existing = articleById(articleId);
  if (isReadUnchanged(existing, nextRead, fallback)) return true;

  const kind = rowKindOf(existing, fallback);
  const feedId = rowFeedIdOf(existing, fallback);
  const previousRead = existing !== null ? existing.read : fallback?.read;
  const startGeneration = requestState.generation;
  const token = beginOptimisticRead(
    articleId,
    existing,
    nextRead,
    kind,
    feedId,
    previousRead
  );

  try {
    await setReadRequest(kind, articleId, nextRead);
    if (token !== undefined) {
      const result = readTracker.succeed(articleId, token, nextRead);
      if (result !== null) {
        reconcileArticleRead(
          articleId,
          result.targetRead,
          kind,
          feedId,
          startGeneration
        );
      }
    }
    return true;
  } catch (error) {
    await handleReadFailure(
      error,
      articleId,
      token,
      kind,
      feedId,
      startGeneration
    );
    return false;
  }
};
