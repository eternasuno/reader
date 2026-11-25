import type { Feed } from '../api';
import { t } from '../i18n';
import {
  activeScope,
  buildLibraryUrl,
  isLibraryMounted,
  isSameScope,
  openArticle,
  unsubscribeFeed,
} from '../state';

export interface FeedListActions {
  unreadOnly: boolean | (() => boolean);
  onNavigate: (url: string) => void;
}

/**
 * `FD-UNSUB-1`: confirms and unsubscribes a feed, navigating to `/all` when it was
 * the active scope or closing an open article belonging to it.
 */
export const deleteFeed = async (
  actions: FeedListActions,
  feed: Feed
): Promise<void> => {
  if (!window.confirm(t('feeds.unsubscribeConfirm'))) return;

  if (!(await unsubscribeFeed(feed))) return;

  // The user may have left the library or switched scopes while the request ran.
  if (!isLibraryMounted()) return;

  const scope = activeScope();
  if (isSameScope(scope, { kind: 'feed', feedId: feed.id })) {
    actions.onNavigate(
      buildLibraryUrl(
        { kind: 'all' },
        {
          unreadOnly:
            typeof actions.unreadOnly === 'function'
              ? actions.unreadOnly()
              : actions.unreadOnly,
        }
      )
    );

    return;
  }

  const open = openArticle();
  if (open?.kind === 'feed' && open.feedId === feed.id) {
    actions.onNavigate(
      buildLibraryUrl(scope, {
        unreadOnly:
          typeof actions.unreadOnly === 'function'
            ? actions.unreadOnly()
            : actions.unreadOnly,
      })
    );
  }
};
