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
      return String(t('library.laterScope'));
    case 'all':
      return String(t('library.allFeedsScope'));
    case 'feed':
      return feeds().find((feed) => feed.id === scope.feedId)?.title ?? '';
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
        title: String(t('later.emptyTitle')),
        hint: String(t('later.emptyHint')),
        action: {
          label: String(t('later.addLinkTitle')),
          run: onRequestAddLink,
        },
      };
    case 'all':
      return {
        title: String(t('feeds.emptyAllTitle')),
        hint: String(t('feeds.emptyAllHint')),
        action: {
          label: String(t('library.addFeed')),
          run: onRequestAddFeed,
        },
      };
    case 'feed':
      return {
        title: String(t('feeds.emptyFeedTitle')),
        hint: String(t('feeds.emptyFeedHint')),
      };
    case 'folder':
      return folderFeeds(scope.folderId).length === 0
        ? {
            title: String(t('folders.emptyNoFeedsTitle')),
            hint: String(t('folders.emptyNoFeedsHint')),
          }
        : {
            title: String(t('folders.emptyNoItemsTitle')),
            hint: String(t('folders.emptyNoItemsHint')),
          };
  }
};
