import { messageOf } from '../api/messages';
import { saveFeedItem } from '../api/saved-page';
import type { FeedItem } from '../library';
import { showToast } from '../ui/toast';
import { adjustSavedPageUnread, reloadSavedPageCount } from './count';
import { savedPageMessages as copy } from './messages';

/**
 * Saves an open feed item to `稍后阅读` as a copy (SP-SAVE, RD-SAVE): the reader
 * stays on the item, the scope's count grows at once, and the copy appears in
 * the later list when it loads (`article.md`, SP-SAVE-4). A page whose URL is
 * already saved shows the duplicate wording and creates nothing (SP-SAVE-3).
 */
export const saveToLater = async (item: FeedItem): Promise<void> => {
  try {
    await saveFeedItem(item.id);
  } catch (error) {
    showToast(messageOf(error), 'error');

    return;
  }

  showToast(copy.saved);
  adjustSavedPageUnread(1);
  await reloadSavedPageCount();
};
