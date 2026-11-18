import {
  allUnreadCount,
  feedById,
  feedUnreadCount,
  folderUnreadCount,
} from '../feed';
import { feedIdsInFolder, folderById } from '../folder';
import { savedPageUnreadCount } from '../saved-page';
import { copy } from './messages';
import type { Article, Scope } from './scope';

/** What a scope is called and how many unread rows it has (LIB-COUNT-1). */

/**
 * The scope's name: its feed's title or folder's name, `目录` / `订阅` while that
 * row is not loaded (library.md Interface, Messages).
 */
export const scopeName = (scope: Scope): string => {
  switch (scope.kind) {
    case 'later':
      return copy.laterName;
    case 'all':
      return copy.allName;
    case 'feed':
      return feedById(scope.id)?.title ?? copy.feedFallbackName;
    case 'folder':
      return folderById(scope.id)?.name ?? copy.folderFallbackName;
  }
};

/** The scope's unread count: saved pages, per-feed counts, or a folder's sum. */
export const scopeUnreadCount = (scope: Scope): number => {
  switch (scope.kind) {
    case 'later':
      return savedPageUnreadCount();
    case 'all':
      return allUnreadCount();
    case 'feed':
      return feedUnreadCount(scope.id);
    case 'folder':
      return folderUnreadCount(scope.id);
  }
};

/**
 * Whether a row belongs to the scope when the operation runs: for a folder, the
 * rows of the feeds it holds now, so a moved-out feed's shown rows stay unread
 * (FD-MOVE-4).
 */
export const inScope = (article: Article, scope: Scope): boolean => {
  switch (scope.kind) {
    case 'later':
      return article.kind === 'saved-page';
    case 'all':
      return article.kind === 'feed-item';
    case 'feed':
      return article.kind === 'feed-item' && article.item.feedId === scope.id;
    case 'folder':
      return (
        article.kind === 'feed-item' &&
        feedIdsInFolder(scope.id).includes(article.item.feedId)
      );
  }
};
