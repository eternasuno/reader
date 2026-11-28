/** Unsubscribing a feed from the sidebar or feed-list menu (`FD-UNSUB-1`). */

import type { Feed } from '../api';
import { feedsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';
import { activeScope, activeUnreadOnly, isLibraryMounted } from './library';
import { reloadScopeInPlace } from './library-motion';
import { removeFeedLocal } from './sidebar';

/**
 * `FD-UNSUB-1`: removes the feed, shows `订阅源已删除`, and reloads an active aggregate
 * (`all` or `folder`) list with a fresh snapshot, discarding in-flight list responses; the
 * feed's rows leave in a list transition.
 */
export const unsubscribeFeed = async (feed: Feed): Promise<boolean> => {
  try {
    await feedsApi.remove(feed.id);
  } catch (error) {
    showToast(errorText(error), 'error');
    return false;
  }

  removeFeedLocal(feed.id);
  showToast(t('feeds.unsubscribedToast'), 'success');

  const scope = activeScope();
  // `activeScope()` outlives the library page; don't reload a list the user already left.
  if (isLibraryMounted() && (scope.kind === 'all' || scope.kind === 'folder')) {
    await reloadScopeInPlace(scope, activeUnreadOnly());
  }

  return true;
};
