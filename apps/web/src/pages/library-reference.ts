import type { LibraryStore } from './library-context';

export const loadFeeds = async (store: LibraryStore): Promise<void> => {
  try {
    const feeds = await store.client.feeds();
    store.setState((current) => ({ ...current, feeds }));
  } catch {}
};

export const loadLaterUnread = async (store: LibraryStore): Promise<void> => {
  try {
    const later = await store.client.laterUnread();
    store.clearNotified('later-unread');
    store.setState((current) => ({
      ...current,
      counts: { ...current.counts, later },
    }));
  } catch (error) {
    store.notifyCategory('later-unread', error);
  }
};

export const loadFeedUnread = async (store: LibraryStore): Promise<void> => {
  try {
    const unread = await store.client.feedUnread();
    store.clearNotified('feeds-unread');
    store.setState((current) => ({
      ...current,
      counts: {
        ...current.counts,
        feeds: unread.feeds,
        feedsTotal: unread.total,
      },
    }));
  } catch (error) {
    store.notifyCategory('feeds-unread', error);
  }
};

export const loadCounts = async (store: LibraryStore): Promise<void> => {
  await Promise.all([loadLaterUnread(store), loadFeedUnread(store)]);
};

export const loadReference = async (store: LibraryStore): Promise<void> => {
  await Promise.all([
    loadFeeds(store),
    loadLaterUnread(store),
    loadFeedUnread(store),
  ]);
};
