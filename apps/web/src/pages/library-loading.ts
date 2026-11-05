import {
  type Filter,
  LibraryError,
  libraryErrorMessage,
  type Scope,
} from '../lib/library';
import type { LibraryStore } from './library-context';
import { applyPage, failList, resetList, startLoadMore } from './library-pages';
import { loadFeeds, loadReference } from './library-reference';
import { applyRefresh, applyRefreshPage } from './library-refresh';
import { sameScope } from './library-state';

export const startLoad = async (
  store: LibraryStore,
  scope: Scope,
  filter: Filter
): Promise<void> => {
  store.setState((current) => resetList(current, scope, filter));
  const generation = store.state().generation;
  try {
    const page = await store.client.list(scope, filter);
    store.setState((current) => applyPage(current, page, generation));
  } catch (error) {
    store.setState((current) =>
      failList(current, libraryErrorMessage(error), generation)
    );
  }
};

const loadNew = async (store: LibraryStore): Promise<void> => {
  const before = store.state();
  const covered = new Set(before.items.map((item) => item.id));
  store.setState((current) => ({ ...current, refreshing: true }));
  try {
    if (before.boundary === null) {
      const page = await store.client.list(before.scope, before.filter);
      store.setState((current) =>
        applyRefreshPage(current, page, before.generation, covered)
      );

      return;
    }

    const items = await store.client.refresh(
      before.scope,
      before.filter,
      before.boundary
    );
    store.setState((current) =>
      applyRefresh(current, items, before.generation, covered)
    );
  } catch (error) {
    store.setState((current) => ({ ...current, refreshing: false }));
    store.notify('error', libraryErrorMessage(error));
  }
};

export const refresh = async (store: LibraryStore): Promise<void> => {
  const current = store.state();
  if (store.flags.isRefreshing() || current.loading) {
    return;
  }

  store.flags.setRefreshing(true);
  try {
    if (!current.initialized) {
      await startLoad(store, current.scope, current.filter);
    } else {
      await loadNew(store);
    }

    await loadReference(store);
  } finally {
    store.flags.setRefreshing(false);
  }
};

export const loadMore = async (store: LibraryStore): Promise<void> => {
  const before = store.state();
  if (before.loading) {
    return;
  }

  if (before.cursorInvalid) {
    await startLoad(store, before.scope, before.filter);

    return;
  }

  const cursor = before.cursor;
  if (cursor === null) {
    return;
  }

  const generation = before.generation;
  store.setState(startLoadMore);
  try {
    const page = await store.client.list(before.scope, before.filter, cursor);
    store.setState((current) => applyPage(current, page, generation));
  } catch (error) {
    const invalid =
      error instanceof LibraryError && error.tag === 'InvalidCursor';
    store.setState((current) =>
      failList(current, libraryErrorMessage(error), generation, invalid)
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

  const filter = store.state().filter;
  store.setState((current) => ({ ...current, scope }));
  const feeds = store.state().feeds.length === 0 ? loadFeeds(store) : undefined;
  await Promise.all([
    startLoad(store, scope, filter),
    ...(feeds === undefined ? [] : [feeds]),
  ]);
};

export const setFilter = async (
  store: LibraryStore,
  filter: Filter
): Promise<void> => {
  if (store.state().filter === filter) {
    return;
  }

  await startLoad(store, store.state().scope, filter);
};

export const selectFeed = async (
  store: LibraryStore,
  feedId: string
): Promise<void> => {
  await setScope(store, { kind: 'feeds', feedId });
};

export const reloadFeed = async (
  store: LibraryStore,
  feedId: string
): Promise<void> => {
  await loadFeeds(store);
  await selectFeed(store, feedId);
};
