import { savedPagesApi } from '../api';
import { t } from '../i18n';
import {
  isLibraryMounted,
  type LibraryArticle,
  openArticleId,
  refreshSidebar,
  removeSavedPageLocal,
  saveFeedItemToLater,
  toggleOpenArticleRead,
} from '../state';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { ReaderNav } from './readerNav';

/** `RD-READ-1`: the store owns the read state, so the header flips synchronously. */
export const toggleRead = async (article: LibraryArticle): Promise<void> => {
  await toggleOpenArticleRead(article, !article.read);
};

/** `later.md:17` / `SP-ADD-1`: save the open feed item and stay on it. */
export const saveOpenArticle = async (
  article: LibraryArticle
): Promise<void> => {
  if (article.kind !== 'feed') return;

  await saveFeedItemToLater(article.id);
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
  if (isLibraryMounted() && openArticleId() === article.id) {
    nav.onNavigate(nav.laterUrl());
  }
};
