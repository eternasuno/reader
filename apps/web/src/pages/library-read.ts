import { Option } from 'effect';
import {
  type Article,
  type Counts,
  libraryErrorMessage,
  refOf,
} from '../lib/library';
import { setItemsRead, upsertItem } from './library-articles';
import { markArticleRefs, markScope } from './library-commands';
import type { LibraryStore } from './library-context';
import { clearScopeCounts, unreadCount } from './library-counts';
import { feedsInFolder } from './library-folders';
import { loadCounts } from './library-reference';
import type { LibraryState } from './library-state';

const reconcileRead = async (
  store: LibraryStore,
  article: Article
): Promise<void> => {
  const id = article.id;
  const version = store.version(id);
  try {
    const fetched = await store.client.article(refOf(article));
    if (version !== store.version(id)) {
      return;
    }

    if (fetched !== null) {
      store.setState((current) => upsertItem(current, fetched));
    }
  } catch {}

  if (version === store.version(id)) {
    await loadCounts(store);
  }
};

const settleRead = async (
  store: LibraryStore,
  article: Article
): Promise<void> => {
  if (!store.writing(article.id)) {
    await reconcileRead(store, article);
  }
};

export const writeRead = async (
  store: LibraryStore,
  article: Article,
  read: boolean
): Promise<boolean> => {
  const id = article.id;
  const token = store.begin(id);
  store.setState((current) => setItemsRead(current, new Set([id]), read));
  try {
    await store.client.markRead(refOf(article), read);
    store.end(id, token);

    await settleRead(store, article);

    return true;
  } catch (error) {
    if (store.end(id, token)) {
      store.setState((current) => setItemsRead(current, new Set([id]), !read));
      store.notify('error', libraryErrorMessage(error));
    }

    await settleRead(store, article);

    return false;
  }
};

const rollbackRead = (store: LibraryStore, ids: ReadonlyArray<string>) => {
  const pending = store.state().pending;
  const targets = ids.filter((id) => !pending.has(id));
  if (targets.length > 0) {
    store.setState((current) => setItemsRead(current, new Set(targets), false));
  }
};

const endAll = (
  store: LibraryStore,
  entries: ReadonlyArray<readonly [string, number]>
) => {
  for (const [id, token] of entries) {
    store.end(id, token);
  }
};

export const markLoaded = async (store: LibraryStore): Promise<void> => {
  const current = store.state();
  const targets = current.items.filter(
    (item) => !item.read && !current.pending.has(item.id)
  );
  const ids = targets.map((item) => item.id);
  if (ids.length === 0) {
    return;
  }

  const entries = ids.map((id) => [id, store.begin(id)] as const);
  store.setState((value) => setItemsRead(value, new Set(ids), true));
  try {
    await markArticleRefs(store.client, targets);
    endAll(store, entries);
    await loadCounts(store);
  } catch (error) {
    endAll(store, entries);
    rollbackRead(store, ids);
    await loadCounts(store);
    store.notify('error', libraryErrorMessage(error));
  }
};

const folderFeedIds = (
  state: LibraryState,
  folderId: string
): ReadonlySet<string> =>
  new Set(feedsInFolder(state.feeds, folderId).map((feed) => feed.id));

const markTargets = (state: LibraryState): ReadonlyArray<Article> => {
  const { scope, items, pending } = state;
  const feedIds =
    scope.kind === 'folder' ? folderFeedIds(state, scope.folderId) : undefined;

  return items.filter((item) => {
    const feedId = Option.getOrUndefined(item.feedId);

    return (
      !item.read &&
      !pending.has(item.id) &&
      (feedIds === undefined || (feedId !== undefined && feedIds.has(feedId)))
    );
  });
};

const failMarkAll = async (
  store: LibraryStore,
  entries: ReadonlyArray<readonly [string, number]>,
  ids: ReadonlyArray<string>,
  counts: Counts,
  error: unknown
): Promise<void> => {
  endAll(store, entries);
  rollbackRead(store, ids);
  store.setState((value) => ({ ...value, counts }));
  await loadCounts(store);
  store.notify('error', libraryErrorMessage(error));
};

export const markAll = async (store: LibraryStore): Promise<void> => {
  const current = store.state();
  const scope = current.scope;
  if (current.pendingScopeWrite) {
    return;
  }

  const targets = markTargets(current);
  const ids = targets.map((item) => item.id);
  if (
    ids.length === 0 &&
    unreadCount(current.counts, scope, current.feeds) === 0
  ) {
    return;
  }

  const counts = current.counts;
  const entries = ids.map((id) => [id, store.begin(id)] as const);
  store.setState((value) => ({
    ...setItemsRead(value, new Set(ids), true),
    counts: clearScopeCounts(value.counts, scope, value.feeds),
    pendingScopeWrite: true,
  }));
  try {
    await markScope(store.client, scope);
    endAll(store, entries);
    await loadCounts(store);
  } catch (error) {
    await failMarkAll(store, entries, ids, counts, error);
  } finally {
    store.setState((value) => ({ ...value, pendingScopeWrite: false }));
  }
};
