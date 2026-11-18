import { createSignal } from 'solid-js';
import {
  type Feed,
  type FeedOrder,
  type FeedReaderMode,
  listFeeds,
} from '../api/feed';

export type { Feed, FeedOrder, FeedReaderMode } from '../api/feed';

const [feedList, setFeedList] = createSignal<ReadonlyArray<Feed>>([]);

/** The owner's feeds in the server's order, never re-sorted here (FD-LIST-3). */
export const feeds = (): ReadonlyArray<Feed> => feedList();

/** Replaces the list; the unsubscribe action removes and restores a row with it. */
export const setFeeds = (next: ReadonlyArray<Feed>): void => {
  setFeedList(next);
};

export const feedById = (id: string): Feed | undefined =>
  feedList().find((feed) => feed.id === id);

/** The stored order of a feed's list; `newest` for a feed not loaded (FD-PREF-3). */
export const feedOrder = (id: string): FeedOrder =>
  feedById(id)?.order ?? 'newest';

/** The stored reader mode of a feed; `default` for a feed not loaded (RD-MODE-4). */
export const feedReaderMode = (id: string): FeedReaderMode =>
  feedById(id)?.readerMode ?? 'default';

/** Changes one loaded feed in place; a feed not loaded is left out. */
export const changeFeed = (id: string, change: (feed: Feed) => Feed): void => {
  setFeedList((list) =>
    list.map((feed) => (feed.id === id ? change(feed) : feed))
  );
};

/** The feed the owner follows at an address (CM-ID-7). */
export const feedByUrl = (url: string): Feed | undefined =>
  feedList().find((feed) => feed.url === url);

/**
 * Lists the feeds again. A failure rejects with `ApiFailure`; `loadSidebar`
 * reports it once (library.md API), while a caller that looks a row up ignores it.
 */
export const loadFeeds = async (): Promise<void> => {
  setFeedList((await listFeeds()).items);
};
