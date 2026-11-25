/**
 * Single-article read toggle (`LIB-READ-1`, `LIB-FILTER-1`) on top of the per-article read sync.
 */

import type { ArticleReadFallback, LibraryArticle } from './library-store';
import { activeScope, articleById } from './library-store';
import type { ReadTarget } from './read-sync';
import { requestRead, targetOf } from './read-sync';

const fallbackTarget = (
  articleId: string,
  nextRead: boolean,
  fallback: ArticleReadFallback | undefined
): ReadTarget => {
  if (fallback !== undefined) {
    return {
      id: articleId,
      kind: fallback.kind,
      feedId: fallback.kind === 'feed' ? (fallback.feedId ?? null) : null,
      read: fallback.read,
    };
  }

  const kind: LibraryArticle['kind'] =
    activeScope().kind === 'later' ? 'later' : 'feed';
  return { id: articleId, kind, feedId: null, read: !nextRead };
};

/**
 * `LIB-FILTER-1` / `LIB-READ-1`: shows `nextRead` immediately and syncs it in the background. Rows
 * never leave the loaded list, and the action is never gated by in-flight state. `fallback`
 * carries context when an article is not in the record store. Resolves once the article's request
 * queue is idle: `true` when the server-confirmed state equals `nextRead`, else `false`.
 */
export const toggleArticleRead = async (
  articleId: string,
  nextRead: boolean,
  fallback?: ArticleReadFallback
): Promise<boolean> => {
  const existing = articleById(articleId);
  const target =
    existing !== null
      ? targetOf(existing)
      : fallbackTarget(articleId, nextRead, fallback);
  const confirmed = await requestRead(target, nextRead);
  return confirmed === nextRead;
};
