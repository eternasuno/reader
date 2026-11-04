import type { LibraryStore } from './library-context';

export const loadFeeds = async (store: LibraryStore): Promise<void> => {
  try {
    const feeds = await store.client.feeds();
    store.setState((current) => ({ ...current, feeds }));
  } catch {}
};

export const loadCounts = async (store: LibraryStore): Promise<void> => {
  try {
    const counts = await store.client.unreadCounts();
    store.clearNotified('unread-counts');
    store.setState((current) => ({ ...current, counts }));
  } catch (error) {
    store.notifyCategory('unread-counts', error);
  }
};

export const loadReference = async (store: LibraryStore): Promise<void> => {
  await Promise.all([loadFeeds(store), loadCounts(store)]);
};
