import { markFeedRead } from '../api/feed';
import {
  markAllFeedItems,
  markFeedItem,
  markFeedItems,
} from '../api/feed-item';
import { markFolderRead } from '../api/folder';
import { messageOf } from '../api/messages';
import {
  markAllSavedPages,
  markSavedPage,
  markSavedPages,
} from '../api/saved-page';
import {
  adjustFeedUnread,
  clearUnread,
  countsSnapshot,
  feeds,
  reloadCounts,
  restoreCounts,
} from '../feed';
import { feedIdsInFolder } from '../folder';
import {
  adjustSavedPageUnread,
  clearSavedPageUnread,
  reloadSavedPageCount,
  savedPageUnreadCount,
} from '../saved-page';
import { showToast } from '../ui/toast';
import { listState, revertRowsRead, rowById, rows, setRowsRead } from './list';
import type { Article, Scope } from './scope';
import { inScope } from './scope-meta';

/**
 * Read marking across the screen (LIB-READ, LIB-COUNT-2): a change is shown at
 * once, rolled back with an error toast when its request fails, and the unread
 * counts are read from the server again once the mark settles.
 */

const idOf = (article: Article): string => article.item.id;

/** The loaded unread rows of a scope when the operation runs (FD-MOVE-4). */
const loadedUnread = (scope: Scope): ReadonlyArray<Article> =>
  rows().filter((article) => !article.item.read && inScope(article, scope));

/** Swallows a count reload's failure: the last known counts stay (LIB-COUNT-2). */
const settle = (reload: () => Promise<void>): Promise<void> =>
  reload().then(
    () => undefined,
    () => undefined
  );

const settleCounts = (savedPage: boolean): Promise<void> =>
  settle(savedPage ? reloadSavedPageCount : reloadCounts);

const adjustCount = (article: Article, read: boolean): void => {
  const delta = read ? -1 : 1;

  if (article.kind === 'saved-page') adjustSavedPageUnread(delta);
  else adjustFeedUnread(article.item.feedId, delta);
};

const sendRead = (article: Article, read: boolean): Promise<void> =>
  article.kind === 'saved-page'
    ? markSavedPage(idOf(article), read)
    : markFeedItem(idOf(article), read);

/**
 * Applies a successful answer to the row it changed (LIB-READ-1): the answers
 * are not queued, so the last one to settle decides what the row shows. A list
 * reloaded meanwhile already holds the server's answer and is left alone.
 */
const applyAnswer = (id: string, read: boolean, generation: number): void => {
  if (listState().generation !== generation) return;

  setRowsRead([id], read);
};

/**
 * Puts back what a failed mark changed (LIB-READ-1): only a row that still
 * shows this request's value is restored, so a newer mark wins, and the count
 * goes back when this mark had moved it.
 */
const rollbackRead = (
  article: Article,
  read: boolean,
  previous: boolean
): void => {
  const id = idOf(article);
  const reverted = revertRowsRead([id], read, previous);

  if (previous !== read && (reverted || rowById(id) === undefined)) {
    adjustCount(article, previous);
  }
};

/**
 * Marks one article read or unread through its own domain endpoint (LIB-READ-1,
 * LIB-READ-2): the loaded row changes at once and stays in the list, the
 * counts move by one, and a failure puts the row back with an error toast. It
 * answers whether the write succeeded, so the reader can settle the copy it
 * keeps of an article the list does not hold (RD-READ-3).
 */
export const setArticleRead = async (
  article: Article,
  read: boolean
): Promise<boolean> => {
  const id = idOf(article);
  const previous = rowById(id)?.item.read ?? article.item.read;
  const generation = listState().generation;
  let written = false;

  setRowsRead([id], read);
  if (previous !== read) adjustCount(article, read);

  try {
    await sendRead(article, read);
    written = true;
    applyAnswer(id, read, generation);
  } catch (failure) {
    rollbackRead(article, read, previous);
    showToast(messageOf(failure), 'error');
  }

  await settleCounts(article.kind === 'saved-page');

  return written;
};

/** Marks the loaded rows read in one request per row kind (LIB-READ-3). */
export const markLoadedRead = async (): Promise<void> => {
  const scope = listState().scope;
  const targets = loadedUnread(scope);
  const ids = targets.map(idOf);
  const savedPage = scope.kind === 'later';
  const feedCounts = countsSnapshot();
  const savedPages = savedPageUnreadCount();

  setRowsRead(ids, true);
  for (const article of targets) adjustCount(article, true);

  try {
    await (savedPage ? markSavedPages(ids) : markFeedItems(ids));
  } catch (failure) {
    revertRowsRead(ids, true, false);
    restoreCountsBefore(scope, feedCounts, savedPages);
    showToast(messageOf(failure), 'error');
  }

  await settleCounts(savedPage);
};

const feedIdsOf = (scope: Scope): ReadonlyArray<string> => {
  switch (scope.kind) {
    case 'later':
      return [];
    case 'all':
      return feeds().map((feed) => feed.id);
    case 'feed':
      return [scope.id];
    case 'folder':
      return feedIdsInFolder(scope.id);
  }
};

const clearScopeCounts = (scope: Scope): void => {
  if (scope.kind === 'later') clearSavedPageUnread();
  else clearUnread(feedIdsOf(scope));
};

const sendMarkAll = (scope: Scope): Promise<void> => {
  switch (scope.kind) {
    case 'later':
      return markAllSavedPages();
    case 'all':
      return markAllFeedItems();
    case 'feed':
      return markFeedRead(scope.id);
    case 'folder':
      return markFolderRead(scope.id);
  }
};

const restoreCountsBefore = (
  scope: Scope,
  feedCounts: ReadonlyMap<string, number>,
  savedPages: number
): void => {
  restoreCounts(feedCounts);

  if (scope.kind === 'later') {
    adjustSavedPageUnread(savedPages - savedPageUnreadCount());
  }
};

/**
 * Marks the whole scope read through its own endpoint, loaded rows and not
 * (LIB-READ-4, LIB-READ-5): the loaded unread rows of the scope and its counters
 * change at once, and a failure restores both (LIB-READ-6).
 */
export const markAllInScope = async (scope: Scope): Promise<void> => {
  const ids = loadedUnread(scope).map(idOf);
  const feedCounts = countsSnapshot();
  const savedPages = savedPageUnreadCount();
  const savedPage = scope.kind === 'later';

  setRowsRead(ids, true);
  clearScopeCounts(scope);

  try {
    await sendMarkAll(scope);
  } catch (failure) {
    revertRowsRead(ids, true, false);
    restoreCountsBefore(scope, feedCounts, savedPages);
    showToast(messageOf(failure), 'error');
  }

  await settleCounts(savedPage);
};
