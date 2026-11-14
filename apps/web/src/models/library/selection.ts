import {
  type Article,
  type ArticleRef,
  LibraryError,
  libraryErrorMessage,
  refOf,
} from '../../api/library';
import { selectSnapshot, upsertItem } from './articles';
import type { LibraryStore } from './context';
import { writeRead } from './read';

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
  ref: ArticleRef
): Promise<OpenResponse> => {
  try {
    const item = await store.client.article(ref);
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
    await writeRead(store, item, true);
  }

  return store.lookup(id) ?? item;
};

export const openArticle = async (
  store: LibraryStore,
  id: string,
  feedId?: string
): Promise<Article | undefined> => {
  const version = store.flags.openVersion() + 1;
  store.flags.setOpenVersion(version);
  const snapshot = store.lookup(id);
  store.setState((current) => selectSnapshot(current, snapshot));
  let item = snapshot;
  const result = await loadOpened(
    store,
    version,
    snapshot === undefined ? { id, feedId } : refOf(snapshot)
  );
  if (result.kind === 'stale') {
    return store.lookup(id);
  }

  if (result.kind === 'article' && result.item !== null) {
    item = result.item;
    applyOpened(store, result.item);
  }

  return finishOpen(store, version, id, item);
};

const isSavedPageDuplicate = (error: unknown): error is LibraryError =>
  error instanceof LibraryError && error.tag === 'SavedPageAlreadyExists';

type SavedPageLookup =
  | { readonly kind: 'found'; readonly page: Article }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly error: unknown };

type DuplicateOutcome =
  | { readonly kind: 'unrelated' }
  | { readonly kind: 'opened' }
  | SavedPageLookup;

const lookupSavedPage = async (
  store: LibraryStore,
  url: string
): Promise<SavedPageLookup> => {
  try {
    const page = await store.client.findSavedPageByUrl(url);

    return page === null ? { kind: 'missing' } : { kind: 'found', page };
  } catch (error) {
    return { kind: 'unavailable', error };
  }
};

/**
 * A saved page that already exists is opened instead of reported: the client
 * asks the server which page owns the submitted URL and selects it. A failed
 * lookup is returned so the caller reports it at the operation boundary.
 */
export const openSavedPageDuplicate = async (
  store: LibraryStore,
  error: unknown,
  submittedUrl: string
): Promise<DuplicateOutcome> => {
  if (!isSavedPageDuplicate(error)) {
    return { kind: 'unrelated' };
  }

  const lookup = await lookupSavedPage(store, error.url ?? submittedUrl);
  if (lookup.kind !== 'found') {
    return lookup;
  }

  store.flags.setOpenVersion(store.flags.openVersion() + 1);
  store.setState((current) => ({
    ...upsertItem(current, lookup.page),
    selected: lookup.page,
  }));

  return { kind: 'opened' };
};

export const clearSelection = (store: LibraryStore) => {
  store.flags.setOpenVersion(store.flags.openVersion() + 1);
  store.setState((current) =>
    current.selected === undefined
      ? current
      : { ...current, selected: undefined }
  );
};
