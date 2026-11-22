import type { Feed } from '../api';
import { t } from '../i18n';
import {
  buildLibraryUrl,
  isLibraryMounted,
  type LibraryScope,
  unsubscribeFeed,
} from '../state';

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
  if (!(await unsubscribeFeed(feed))) return;
  // The user may have left the library while the request ran; don't navigate them back.
  if (!isLibraryMounted()) return;

  actions.onNavigate(
    buildLibraryUrl({ kind: 'all' }, { unreadOnly: actions.unreadOnly })
  );
};
