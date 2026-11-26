/**
 * Network transport and post-ambiguous-failure detail re-fetch for `read-sync.ts`.
 */

import { flush } from 'solid-js';
import type { FeedItem, SavedPage } from '../api';
import { ApiError, feedItemsApi, savedPagesApi } from '../api';
import type { LibraryArticle } from './library-store';
import { articleById, toLibraryArticle, upsertArticle } from './library-store';
import { beginRecordSnapshot, queueState } from './read-sync-state';

export const isAmbiguousError = (error: unknown): boolean =>
  !(error instanceof ApiError && error.status > 0);

export const sendSetRead = (
  kind: LibraryArticle['kind'],
  id: string,
  read: boolean
): Promise<void> =>
  kind === 'later'
    ? savedPagesApi.setRead(id, read)
    : feedItemsApi.setRead(id, read);

export const sendMarkIdsRead = (
  kind: LibraryArticle['kind'],
  ids: ReadonlyArray<string>
): Promise<void> =>
  kind === 'later'
    ? savedPagesApi.markIdsRead(ids)
    : feedItemsApi.markIdsRead(ids);

/** Fetches one article detail; `null` when it no longer exists. */
export const fetchArticle = async (
  kind: LibraryArticle['kind'],
  id: string
): Promise<LibraryArticle | null> => {
  const remote: SavedPage | FeedItem | null =
    kind === 'later'
      ? await savedPagesApi.getById(id)
      : await feedItemsApi.getById(id);
  return remote === null ? null : toLibraryArticle(kind, remote);
};

export const refetchArticleSnapshot = async (
  article: LibraryArticle,
  sentEpoch: number
): Promise<void> => {
  const snapshot = beginRecordSnapshot();
  try {
    const loaded = await fetchArticle(article.kind, article.id);
    if (
      sentEpoch !== queueState.epoch ||
      loaded === null ||
      articleById(article.id) === null
    ) {
      return;
    }
    upsertArticle(loaded, snapshot.seq);
    flush();
  } catch {
    // Re-fetch is best-effort after an ambiguous failure.
  } finally {
    snapshot.release();
  }
};
