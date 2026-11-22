import { type Feed, feedsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { errorText } from './errorText';

/** `FD-SCHED-3`: repeated refresh failures surface a subtle warning. */
export const FAILURE_WARNING_THRESHOLD = 3;

export const hasRefreshFailures = (feed: Feed): boolean =>
  feed.failureCount >= FAILURE_WARNING_THRESHOLD;

/** `FD-SCHED-3`: manual retry from the warning menu. */
export const retryRefresh = async (feed: Feed): Promise<void> => {
  try {
    await feedsApi.refresh(feed.id);
    showToast(String(t('feeds.refreshingToast')), 'success');
  } catch (error) {
    showToast(errorText(error), 'error');
  }
};
