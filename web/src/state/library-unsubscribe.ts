/** Unsubscribing a feed from the sidebar or feed-list menu (`FD-UNSUB-1`). */

import type { Feed } from '../api';
import { errorCodeOf, feedsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import {
  activeScope,
  activeUnreadOnly,
  isLibraryMounted,
  loadScopeFirstPage,
} from './library';
import { removeFeedLocal } from './sidebar';

/**
 * `FD-UNSUB-1`: removes the feed, shows `订阅源已删除`, and reloads an active aggregate
 * (`all` or `folder`) list from page 1 so in-flight pages are discarded and the cursor resets.
 */
export const unsubscribeFeed = async (feed: Feed): Promise<boolean> => {
  try {
    await feedsApi.remove(feed.id);
  } catch (error) {
    showToast(translateErrorCode(errorCodeOf(error)), 'error');
    return false;
  }

  removeFeedLocal(feed.id);
  showToast(String(t('feeds.unsubscribedToast')), 'success');

  const scope = activeScope();
  // `activeScope()` outlives the library page; don't reload a list the user already left.
  if (isLibraryMounted() && (scope.kind === 'all' || scope.kind === 'folder')) {
    await loadScopeFirstPage(scope, activeUnreadOnly());
  }

  return true;
};
