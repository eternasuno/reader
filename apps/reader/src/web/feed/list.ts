import { createSignal } from 'solid-js';
import { type Feed, listFeeds } from '../api/feed';

export type { Feed } from '../api/feed';

const [feedList, setFeedList] = createSignal<ReadonlyArray<Feed>>([]);

/** The owner's feeds in the server's order, never re-sorted here (FD-LIST-3). */
export const feeds = (): ReadonlyArray<Feed> => feedList();

/** Replaces the list; the unsubscribe action removes and restores a row with it. */
export const setFeeds = (next: ReadonlyArray<Feed>): void => {
  setFeedList(next);
};

export const feedById = (id: string): Feed | undefined =>
  feedList().find((feed) => feed.id === id);

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
