import { type Article, libraryErrorMessage } from '../lib/library';
import { selectSnapshot, upsertItem } from './library-articles';
import { duplicateId } from './library-commands';
import type { LibraryStore } from './library-context';
import { writeRead } from './library-read';

type OpenResponse =
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'article'; readonly item: Article | null };

const applyOpened = (store: LibraryStore, fetched: Article) => {
  store.setState((current) => ({
    ...upsertItem(current, fetched),
    selected: fetched,
  }));
};

const loadOpened = async (
  store: LibraryStore,
  version: number,
  id: string
): Promise<OpenResponse> => {
  try {
    const item = await store.client.article(id);
    if (version !== store.flags.openVersion()) {
      return { kind: 'stale' };
    }

    return { kind: 'article', item };
  } catch (error) {
    if (version !== store.flags.openVersion()) {
      return { kind: 'stale' };
    }
    store.notify('error', libraryErrorMessage(error));

    return { kind: 'failed' };
  }
};

const finishOpen = async (
  store: LibraryStore,
  version: number,
  id: string,
  item: Article | undefined
): Promise<Article | undefined> => {
  if (version !== store.flags.openVersion()) {
    return store.lookup(id);
  }
  if (item !== undefined && !item.read) {
    await writeRead(store, id, true);
  }

  return store.lookup(id) ?? item;
};

export const openArticle = async (
  store: LibraryStore,
  id: string
): Promise<Article | undefined> => {
  const version = store.flags.openVersion() + 1;
  store.flags.setOpenVersion(version);
  const snapshot = store.lookup(id);
  store.setState((current) => selectSnapshot(current, snapshot));
  let item = snapshot;
  const result = await loadOpened(store, version, id);
  if (result.kind === 'stale') {
    return store.lookup(id);
  }
  if (result.kind === 'article' && result.item !== null) {
    item = result.item;
    applyOpened(store, result.item);
  }

  return finishOpen(store, version, id, item);
};

export const openDuplicate = async (
  store: LibraryStore,
  error: unknown
): Promise<boolean> => {
  const id = duplicateId(error);
  if (id === undefined) {
    return false;
  }
  await openArticle(store, id);

  return true;
};

export const clearSelection = (store: LibraryStore) => {
  store.flags.setOpenVersion(store.flags.openVersion() + 1);
  store.setState((current) =>
    current.selected === undefined
      ? current
      : { ...current, selected: undefined }
  );
};
