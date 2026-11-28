import type { Feed } from '../api';
import { t } from '../i18n';
import {
  allFeedsUnreadCount,
  feeds,
  feedUnreadCount,
  folderFeeds,
  folders,
  folderUnreadCount,
  type LibraryScope,
  savedUnreadCount,
} from '../state';
import { hasRefreshFailures } from './feedFailure';

/** All-feeds and folder lists group rows under feed separators (`LIB-GROUP-1`). */
export const isGroupedScope = (scope: LibraryScope): boolean =>
  scope.kind === 'all' || scope.kind === 'folder';

export interface EmptyCopy {
  title: string;
  hint: string;
  action?: { label: string; run: () => void };
}

/** The feed the current scope points at, when it points at a single feed. */
export const activeFeed = (scope: LibraryScope): Feed | null => {
  if (scope.kind !== 'feed') return null;

  return feeds().find((feed) => feed.id === scope.feedId) ?? null;
};

/** `FD-SCHED-3`: only repeat offenders escalate to the heading warning. */
export const failingFeed = (scope: LibraryScope): Feed | null => {
  const feed = activeFeed(scope);

  return feed !== null && hasRefreshFailures(feed) ? feed : null;
};

export const scopeTitle = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case 'later':
      return t('library.laterScope');
    case 'all':
      return t('library.allFeedsScope');
    case 'feed':
      return activeFeed(scope)?.title ?? '';
    case 'folder':
      return (
        folders().find((folder) => folder.id === scope.folderId)?.name ?? ''
      );
  }
};

/** `LIB-COUNT-1`: the list heading always shows the scope count, even at zero. */
export const scopeUnreadCount = (scope: LibraryScope): number => {
  switch (scope.kind) {
    case 'later':
      return savedUnreadCount();
    case 'all':
      return allFeedsUnreadCount();
    case 'feed':
      return feedUnreadCount(scope.feedId);
    case 'folder':
      return folderUnreadCount(scope.folderId);
  }
};

export const emptyCopy = (
  scope: LibraryScope,
  onRequestAddLink: () => void,
  onRequestAddFeed: () => void
): EmptyCopy => {
  switch (scope.kind) {
    case 'later':
      return {
        title: t('later.emptyTitle'),
        hint: t('later.emptyHint'),
        action: {
          label: t('later.addLinkTitle'),
          run: onRequestAddLink,
        },
      };
    case 'all':
      return {
        title: t('feeds.emptyAllTitle'),
        hint: t('feeds.emptyAllHint'),
        action: {
          label: t('library.addFeed'),
          run: onRequestAddFeed,
        },
      };
    case 'feed':
      return {
        title: t('feeds.emptyFeedTitle'),
        hint: t('feeds.emptyFeedHint'),
      };
    case 'folder':
      return folderFeeds(scope.folderId).length === 0
        ? {
            title: t('folders.emptyNoFeedsTitle'),
            hint: t('folders.emptyNoFeedsHint'),
          }
        : {
            title: t('folders.emptyNoItemsTitle'),
            hint: t('folders.emptyNoItemsHint'),
          };
  }
};
