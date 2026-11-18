import { messageOf } from '../api/messages';
import { loadFolders } from '../folder';
import { showToast } from '../ui/toast';
import { loadCounts } from './counts';
import { loadFeeds } from './list';

/** Whether the failure of the current run has already been reported. */
let failureShown = false;

const reportFailure = (failure: unknown): void => {
  if (failureShown) return;

  failureShown = true;
  showToast(messageOf(failure), 'error');
};

/**
 * The sidebar's data: the feeds, the folders and the unread counts (LIB-REFRESH-1
 * note). A failing request keeps the last values and shows one error toast, once,
 * until the same load succeeds again (library.md API last bullet).
 */
export const loadSidebar = async (): Promise<void> => {
  const failures: Array<unknown> = [];
  const collect = (error: unknown): void => {
    failures.push(error);
  };

  await Promise.all([
    loadFeeds().catch(collect),
    loadFolders().catch(collect),
    loadCounts().catch(collect),
  ]);

  if (failures.length === 0) {
    failureShown = false;

    return;
  }

  reportFailure(failures[0]);
};
