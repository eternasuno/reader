import { libraryErrorMessage } from '../lib/library';
import { setItemsRead, upsertItem } from './library-articles';
import { feedScopeIds, markArticleIds, markScope } from './library-commands';
import type { LibraryStore } from './library-context';
import { clearScopeCounts, unreadCount } from './library-counts';
import { loadCounts } from './library-reference';

const reconcileRead = async (
  store: LibraryStore,
  id: string
): Promise<void> => {
  const version = store.version(id);
  try {
    const fetched = await store.client.article(id);
    if (version !== store.version(id)) {
      return;
    }
    if (fetched !== null) {
      store.setState((current) => ({
        ...upsertItem(current, fetched),
        selected: current.selected?.id === id ? fetched : current.selected,
      }));
    }
  } catch {}

  if (version === store.version(id)) {
    await loadCounts(store);
  }
};

const settleRead = async (store: LibraryStore, id: string): Promise<void> => {
  if (!store.writing(id)) {
    await reconcileRead(store, id);
  }
};

export const writeRead = async (
  store: LibraryStore,
  id: string,
  read: boolean
): Promise<boolean> => {
  const token = store.begin(id);
  store.setState((current) => setItemsRead(current, new Set([id]), read));
  try {
    await store.client.markRead(id, read);
    if (store.end(id, token)) {
      store.setState((current) => setItemsRead(current, new Set([id]), read));
    }

    await settleRead(store, id);

    return true;
  } catch (error) {
    if (store.end(id, token)) {
      store.setState((current) => setItemsRead(current, new Set([id]), !read));
      store.notify('error', libraryErrorMessage(error));
    }

    await settleRead(store, id);

    return false;
  }
};

const rollbackRead = (store: LibraryStore, ids: readonly string[]) => {
  const pending = store.state().pending;
  const targets = ids.filter((id) => !pending.has(id));
  if (targets.length > 0) {
    store.setState((current) => setItemsRead(current, new Set(targets), false));
  }
};

const endAll = (
  store: LibraryStore,
  entries: readonly (readonly [string, number])[]
) => {
  for (const [id, token] of entries) {
    store.end(id, token);
  }
};

export const markLoaded = async (store: LibraryStore): Promise<void> => {
  const current = store.state();
  const ids = current.items
    .filter((item) => !item.read && !current.pending.has(item.id))
    .map((item) => item.id);
  if (ids.length === 0) {
    return;
  }
  const entries = ids.map((id) => [id, store.begin(id)] as const);
  store.setState((value) => setItemsRead(value, new Set(ids), true));
  try {
    await markArticleIds(store.client, ids);
    endAll(store, entries);
    await loadCounts(store);
  } catch (error) {
    endAll(store, entries);
    rollbackRead(store, ids);
    await loadCounts(store);
    store.notify('error', libraryErrorMessage(error));
  }
};

export const markAll = async (store: LibraryStore): Promise<void> => {
  const current = store.state();
  const scope = current.scope;
  const feedIds = feedScopeIds(scope, current.feeds);
  const ids = current.items
    .filter((item) => !item.read && !current.pending.has(item.id))
    .map((item) => item.id);
  if (ids.length === 0 && unreadCount(current.counts, scope) === 0) {
    return;
  }
  const counts = current.counts;
  const entries = ids.map((id) => [id, store.begin(id)] as const);
  store.setState((value) => ({
    ...setItemsRead(value, new Set(ids), true),
    counts: clearScopeCounts(value.counts, scope),
  }));
  try {
    await markScope(store.client, scope, feedIds, ids);
    endAll(store, entries);
    await loadCounts(store);
  } catch (error) {
    endAll(store, entries);
    rollbackRead(store, ids);
    store.setState((value) => ({ ...value, counts }));
    await loadCounts(store);
    store.notify('error', libraryErrorMessage(error));
  }
};
