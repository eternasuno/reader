import { type Feed, feedsApi } from '../api';
import { t } from '../i18n';
import { buildLibraryUrl, type LibraryScope, removeFeedLocal } from '../state';
import { showToast } from '../ui';
import { errorText } from './errorText';

export interface FeedListActions {
  scope: LibraryScope;
  unreadOnly: boolean;
  onNavigate: (url: string) => void;
}

/** Deleting the listed feed drops back to the unfiltered all-feeds scope. */
export const deleteFeed = async (
  actions: FeedListActions,
  feed: Feed
): Promise<void> => {
  if (!window.confirm(String(t('feeds.unsubscribeConfirm')))) return;

  try {
    await feedsApi.remove(feed.id);
  } catch (error) {
    showToast(errorText(error), 'error');
    return;
  }

  removeFeedLocal(feed.id);
  actions.onNavigate(
    buildLibraryUrl({ kind: 'all' }, { unreadOnly: actions.unreadOnly })
  );
};
