import { ApiError, savedPagesApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';
import { insertSavedPageLocal } from './library';
import * as sidebar from './sidebar';

const savingToLaterIds = new Set<string>();
let saveEpoch = 0;

const showSaveError = (error: unknown): void => {
  if (error instanceof ApiError && error.code === 'SavedPageAlreadyExists') {
    showToast(t('errors.SavedPageAlreadyExists'), 'info');

    return;
  }

  showToast(errorText(error), 'error');
};

/** `later.md:17` / `SP-ADD-1`: saves a feed item to Read Later once per concurrent request. */
export const saveFeedItemToLater = async (articleId: string): Promise<void> => {
  if (savingToLaterIds.has(articleId)) return;

  const requestEpoch = saveEpoch;
  savingToLaterIds.add(articleId);
  try {
    const page = await savedPagesApi.saveFeedItem(articleId);
    if (requestEpoch !== saveEpoch) return;

    insertSavedPageLocal(page);
    showToast(t('later.savedFromFeedToast'), 'success');
    void sidebar.refreshSidebar();
  } catch (error) {
    if (requestEpoch === saveEpoch) showSaveError(error);
  } finally {
    if (requestEpoch === saveEpoch) savingToLaterIds.delete(articleId);
  }
};

export const clearReaderSaveState = (): void => {
  saveEpoch += 1;
  savingToLaterIds.clear();
};
