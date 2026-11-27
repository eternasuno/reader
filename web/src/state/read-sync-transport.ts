/**
 * Network transport and post-drain recovery for `read-sync.ts`.
 */

import type { FeedItem, SavedPage } from '../api';
import { ApiError, feedItemsApi, savedPagesApi } from '../api';
import type { LibraryArticle } from './library-store';
import { articleById, hasNewerRecord, toLibraryArticle } from './library-store';
import { refreshWindow, retryWindow } from './library-window';
import {
  ambiguousIds,
  dropIdleUnknownEntry,
  entries,
  isEntryIdle,
  queueState,
} from './read-sync-state';
import { openArticle, refreshOpenArticle } from './reader';

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

const needsReaderRecovery = (
  id: string,
  settledAt: number,
  sentEpoch: number
): boolean => {
  const entry = entries.get(id);
  return (
    sentEpoch === queueState.epoch &&
    entry?.settledAt === settledAt &&
    isEntryIdle(entry) &&
    !entry.confirmedKnown
  );
};

const recoverOpenArticle = async (
  id: string,
  settledAt: number,
  sentEpoch: number
): Promise<void> => {
  // Join the window refresh before falling back to a detail GET for the reader.
  await retryWindow();
  await refreshOpenArticle(
    (article) =>
      article.id === id && needsReaderRecovery(id, settledAt, sentEpoch),
    (seq) =>
      needsReaderRecovery(id, settledAt, sentEpoch) && !hasNewerRecord(id, seq)
  );
};

export const recoverReadSnapshots = (): void => {
  if (ambiguousIds.size === 0) return;

  let refresh = false;
  for (const id of ambiguousIds) {
    if (articleById(id) === null) dropIdleUnknownEntry(id);
    else refresh = true;
  }

  const article = openArticle();
  const recoverReader = article !== null && ambiguousIds.has(article.id);
  ambiguousIds.clear();
  if (refresh) refreshWindow();
  if (!recoverReader) return;

  const entry = entries.get(article.id);
  if (entry !== undefined && !entry.confirmedKnown)
    void recoverOpenArticle(article.id, entry.settledAt, queueState.epoch);
};
