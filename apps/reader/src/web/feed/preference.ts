import {
  type FeedOrder,
  type FeedReaderMode,
  setFeedOrder,
  setFeedReaderMode,
} from '../api/feed';
import { messageOf } from '../api/messages';
import { showToast } from '../ui/toast';
import { changeFeed, type Feed, feedById } from './list';

type Preference = Pick<Feed, 'readerMode' | 'order'>;

/**
 * Shows the new value at once and writes it (feeds.md Changing a feed's
 * preferences): a quick action, so nothing is disabled. A failed write puts the
 * previous value back, unless a newer choice already replaced it, and shows the
 * error toast.
 */
const writePreference = async <K extends keyof Preference>(
  feedId: string,
  key: K,
  value: Preference[K],
  write: () => Promise<void>
): Promise<void> => {
  const feed = feedById(feedId);

  if (feed === undefined || feed[key] === value) return;

  const previous = feed[key];

  changeFeed(feedId, (row) => ({ ...row, [key]: value }));

  try {
    await write();
  } catch (error) {
    changeFeed(feedId, (row) =>
      row[key] === value ? { ...row, [key]: previous } : row
    );
    showToast(messageOf(error), 'error');
  }
};

/** Stores the order of the feed's list; the list follows it (FD-PREF-3). */
export const chooseFeedOrder = (feedId: string, order: FeedOrder) =>
  writePreference(feedId, 'order', order, () => setFeedOrder(feedId, order));

/** Stores what the reader shows first for the feed's items (FD-PREF-1). */
export const chooseFeedReaderMode = (
  feedId: string,
  readerMode: FeedReaderMode
) =>
  writePreference(feedId, 'readerMode', readerMode, () =>
    setFeedReaderMode(feedId, readerMode)
  );
