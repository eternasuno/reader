import type { LibraryStore } from './context';

export const loadFeeds = async (store: LibraryStore): Promise<void> => {
  try {
    const feeds = await store.client.feeds();
    store.clearNotified('feeds');
    store.setState((current) => ({ ...current, feeds }));
  } catch (error) {
    store.notifyCategory('feeds', error);
  }
};

export const loadFolders = async (store: LibraryStore): Promise<void> => {
  try {
    const folders = await store.client.folders();
    store.clearNotified('folders');
    store.setState((current) => ({ ...current, folders }));
  } catch (error) {
    store.notifyCategory('folders', error);
  }
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
  await Promise.all([loadFeeds(store), loadFolders(store), loadCounts(store)]);
};
