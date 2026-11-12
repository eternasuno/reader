import { libraryErrorMessage, type Scope } from '../lib/library';
import type { LibraryStore } from './library-context';
import { applyPage, failList, resetList, startLoadMore } from './library-pages';
import { loadFeeds, loadFolders, loadReference } from './library-reference';
import { isBusy, sameScope } from './library-state';

export const startLoad = async (
  store: LibraryStore,
  scope: Scope,
  unreadOnly: boolean
): Promise<void> => {
  store.setState((current) => resetList(current, scope, unreadOnly));
  const generation = store.state().generation;
  try {
    const page = await store.client.list(scope, unreadOnly);
    store.setState((current) => applyPage(current, page, generation));
  } catch (error) {
    store.setState((current) =>
      failList(current, libraryErrorMessage(error), generation)
    );
  }
};

export const refresh = async (store: LibraryStore): Promise<void> => {
  if (isBusy(store.state()) || store.flags.isRefreshing()) {
    return;
  }

  const { scope, unreadOnly } = store.state();
  store.flags.setRefreshing(true);
  try {
    await Promise.all([
      startLoad(store, scope, unreadOnly),
      loadReference(store),
    ]);
  } finally {
    store.flags.setRefreshing(false);
  }
};

export const enter = async (
  store: LibraryStore,
  scope: Scope
): Promise<void> => {
  store.setState((current) =>
    sameScope(current.scope, scope) ? current : { ...current, scope }
  );
  await refresh(store);
};

export const loadMore = async (store: LibraryStore): Promise<void> => {
  const before = store.state();
  if (before.loading) {
    return;
  }

  const cursor = before.cursor;
  if (cursor === null) {
    return;
  }

  const generation = before.generation;
  store.setState(startLoadMore);
  try {
    const page = await store.client.list(
      before.scope,
      before.unreadOnly,
      cursor
    );
    store.setState((current) => applyPage(current, page, generation));
  } catch (error) {
    store.setState((current) =>
      failList(current, libraryErrorMessage(error), generation)
    );
  }
};

export const setScope = async (
  store: LibraryStore,
  scope: Scope
): Promise<void> => {
  if (sameScope(store.state().scope, scope)) {
    return;
  }

  store.setState((current) => ({ ...current, scope }));
  const feeds = store.state().feeds.length === 0 ? loadFeeds(store) : undefined;
  const folders =
    store.state().folders.length === 0 ? loadFolders(store) : undefined;
  await Promise.all([
    startLoad(store, scope, store.state().unreadOnly),
    ...(feeds === undefined ? [] : [feeds]),
    ...(folders === undefined ? [] : [folders]),
  ]);
};

export const setFilter = async (
  store: LibraryStore,
  unreadOnly: boolean
): Promise<void> => {
  if (store.state().unreadOnly === unreadOnly) {
    return;
  }

  await startLoad(store, store.state().scope, unreadOnly);
};

export const selectFeed = async (
  store: LibraryStore,
  feedId: string
): Promise<void> => {
  await setScope(store, { kind: 'feeds', feedId });
};
