import type { Accessor, Setter } from 'solid-js';
import { ApiError, savedPagesApi } from '../api';
import { t } from '../i18n';
import {
  type LibraryArticle,
  refreshSidebar,
  removeSavedPageLocal,
  toggleArticleRead,
} from '../state';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { ReaderNav } from './readerNav';

/** `RD-READ-1`: the store owns the read state, so the header flips synchronously. */
export const toggleRead = async (article: LibraryArticle): Promise<void> => {
  await toggleArticleRead(article.id, !article.read, {
    kind: article.kind,
    feedId: article.kind === 'feed' ? article.feedId : null,
    read: article.read,
  });
};

/** `later.md:17` / `SP-ADD-1`: save the open feed item and stay on it. */
export const saveOpenArticle = async (
  article: LibraryArticle,
  inFlight: Accessor<boolean>,
  setInFlight: Setter<boolean>
): Promise<void> => {
  if (inFlight()) return;

  setInFlight(true);
  try {
    await savedPagesApi.saveFeedItem(article.id);
    showToast(String(t('later.savedFromFeedToast')), 'success');
    void refreshSidebar();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SavedPageAlreadyExists') {
      showToast(String(t('errors.SavedPageAlreadyExists')), 'info');
    } else {
      showToast(errorText(error), 'error');
    }
  } finally {
    setInFlight(false);
  }
};

/** `later.md:18`: deleting a saved page returns to `/later`. */
export const deleteOpenArticle = async (
  nav: ReaderNav,
  article: LibraryArticle
): Promise<void> => {
  if (article.kind !== 'later') return;
  if (!window.confirm(String(t('later.deleteConfirm')))) return;

  try {
    await savedPagesApi.remove(article.id);
  } catch (error) {
    showToast(errorText(error), 'error');
    return;
  }

  removeSavedPageLocal(article.id);
  void refreshSidebar();
  nav.onNavigate(nav.laterUrl());
};
