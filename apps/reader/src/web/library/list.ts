import { createSignal } from 'solid-js';
import type { ListPage } from '../api/client';
import { type FeedOrder, listFeedItemsOfFeed } from '../api/feed';
import { listFeedItems } from '../api/feed-item';
import { listFolderItems } from '../api/folder';
import { messageOf } from '../api/messages';
import { listSavedPages } from '../api/saved-page';
import { feedOrder } from '../feed';
import {
  type Article,
  type FeedItem,
  type SavedPage,
  type Scope,
  sameScope,
} from './scope';

/**
 * The article list of the selected scope: the loaded rows in arrival order and
 * the paging that appends to them (LIB-LIST, LIB-RELOAD). One request is in
 * flight at a time; a page that resolves after a newer list is discarded.
 */

export const pageSize = 30;

type ListState = {
  readonly rows: ReadonlyArray<Article>;
  readonly scope: Scope;
  readonly unread: boolean;
  /** The order the list was started with; only a single feed uses it (FD-PREF-3). */
  readonly order: FeedOrder;
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly initialized: boolean;
  readonly error: string | undefined;
  readonly generation: number;
};

const initialState: ListState = {
  rows: [],
  scope: { kind: 'later' },
  unread: false,
  order: 'newest',
  cursor: null,
  loading: false,
  initialized: false,
  error: undefined,
  generation: 0,
};

const [state, setState] = createSignal<ListState>(initialState);

/** The list as it is: rows, the page cursor, the load and error state. */
export const listState = (): ListState => state();

/** The loaded rows, newest first in arrival order (LIB-LIST-1). */
export const rows = (): ReadonlyArray<Article> => state().rows;

/** The loaded row of an id, when it is loaded. */
export const rowById = (id: string): Article | undefined =>
  state().rows.find((row) => row.item.id === id);

const idOf = (article: Article): string => article.item.id;

const withRead = (article: Article, read: boolean): Article =>
  article.kind === 'saved-page'
    ? { kind: 'saved-page', item: { ...article.item, read } }
    : { kind: 'feed-item', item: { ...article.item, read } };

const mapRows = (
  targets: ReadonlySet<string>,
  transform: (article: Article) => Article
): void => {
  setState((current) => ({
    ...current,
    rows: current.rows.map((row) =>
      targets.has(idOf(row)) ? transform(row) : row
    ),
  }));
};

/** Marks the loaded rows of the ids read or unread. */
export const setRowsRead = (
  ids: ReadonlyArray<string>,
  read: boolean
): void => {
  const targets = new Set(ids);

  mapRows(targets, (row) => withRead(row, read));
};

/**
 * Puts back the rows a failed mark turned read (LIB-READ-1, LIB-READ-6): only a
 * row that still shows the optimistic value is restored, so a newer mark wins.
 * Answers whether a row was restored.
 */
export const revertRowsRead = (
  ids: ReadonlyArray<string>,
  optimistic: boolean,
  restored: boolean
): boolean => {
  const targets = new Set(ids);
  let reverted = false;

  setState((current) => ({
    ...current,
    rows: current.rows.map((row) => {
      if (!targets.has(idOf(row)) || row.item.read !== optimistic) return row;

      reverted = true;

      return withRead(row, restored);
    }),
  }));

  return reverted;
};

/** Replaces a loaded row; a row that is not loaded is left out (LIB-LIST-3). */
export const replaceRow = (article: Article): void => {
  const targets = new Set([idOf(article)]);

  mapRows(targets, () => article);
};

/** A restore that has nothing to do: the row was not loaded. */
const unchanged = (): void => undefined;

/**
 * Drops a loaded row at once and answers how to put it back (later.md Removing a
 * saved page): the restore re-inserts the row at its former index, clamped to the
 * list as it is then, unless the id is loaded again or the list was reloaded
 * since. A row that is not loaded is not dropped and has nothing to restore.
 */
export const removeRow = (id: string): (() => void) => {
  const loaded = state();
  const index = loaded.rows.findIndex((row) => idOf(row) === id);
  const removed = loaded.rows[index];

  if (removed === undefined) return unchanged;

  setState((current) => ({
    ...current,
    rows: current.rows.filter((row) => idOf(row) !== id),
  }));

  return () => {
    setState((current) => {
      if (current.generation !== loaded.generation) return current;
      if (current.rows.some((row) => idOf(row) === id)) return current;

      const at = Math.min(index, current.rows.length);

      return {
        ...current,
        rows: [
          ...current.rows.slice(0, at),
          removed,
          ...current.rows.slice(at),
        ],
      };
    });
  };
};

/**
 * Puts a just-added row at the top (later.md Adding a link): only when the loaded
 * list is of that scope and does not hold the row yet, since a list of another
 * scope is replaced by its own reload.
 */
export const prependRow = (scope: Scope, article: Article): void => {
  setState((current) => {
    if (!sameScope(current.scope, scope)) return current;
    if (current.rows.some((row) => idOf(row) === idOf(article))) return current;

    return { ...current, rows: [article, ...current.rows] };
  });
};

const savedPageRow = (item: SavedPage): Article => ({
  kind: 'saved-page',
  item,
});

const feedItemRow = (item: FeedItem): Article => ({ kind: 'feed-item', item });

const listPage = async (
  { scope, unread, order }: ListState,
  cursor: string | undefined
): Promise<ListPage<Article>> => {
  const query = { limit: pageSize, unread, cursor };

  switch (scope.kind) {
    case 'later': {
      const page = await listSavedPages(query);

      return { items: page.items.map(savedPageRow), cursor: page.cursor };
    }
    case 'all': {
      const page = await listFeedItems(query);

      return { items: page.items.map(feedItemRow), cursor: page.cursor };
    }
    case 'feed': {
      const page = await listFeedItemsOfFeed(scope.id, query, order);

      return { items: page.items.map(feedItemRow), cursor: page.cursor };
    }
    case 'folder': {
      const page = await listFolderItems(scope.id, query);

      return { items: page.items.map(feedItemRow), cursor: page.cursor };
    }
  }
};

const appendRows = (
  loaded: ReadonlyArray<Article>,
  incoming: ReadonlyArray<Article>
): ReadonlyArray<Article> => {
  const known = new Set(loaded.map(idOf));
  const added = incoming.filter((article) => !known.has(idOf(article)));

  return [...loaded, ...added];
};

const loadPage = async (
  generation: number,
  cursor: string | undefined
): Promise<void> => {
  const current = state();

  if (current.generation !== generation) return;

  try {
    const page = await listPage(current, cursor);

    if (state().generation !== generation) return;

    setState((value) => ({
      ...value,
      rows: appendRows(value.rows, page.items),
      cursor: page.cursor,
      loading: false,
      initialized: true,
      error: undefined,
    }));
  } catch (failure) {
    if (state().generation !== generation) return;

    setState((value) => ({
      ...value,
      loading: false,
      error: messageOf(failure),
    }));
  }
};

/**
 * Starts the list over from the first page (LIB-RELOAD-1, LIB-RELOAD-2): the
 * loaded rows go, the banner clears, and an answer of the previous list is
 * discarded. A single feed is listed in its stored order, kept for every page
 * of this list (FD-PREF-3, CM-PAGE-7).
 */
export const reloadList = async (
  scope: Scope,
  unread: boolean
): Promise<void> => {
  const generation = state().generation + 1;

  setState({
    rows: [],
    scope,
    unread,
    order: scope.kind === 'feed' ? feedOrder(scope.id) : 'newest',
    cursor: null,
    loading: true,
    initialized: false,
    error: undefined,
    generation,
  });

  await loadPage(generation, undefined);
};

/** Asks for the next page with the last loaded row's cursor (LIB-LIST-2). */
export const loadNextPage = async (): Promise<void> => {
  const current = state();

  if (current.loading || !current.initialized) return;
  if (current.cursor === null) return;

  setState((value) => ({ ...value, loading: true, error: undefined }));

  await loadPage(current.generation, current.cursor);
};

/** Repeats the request that failed (LIB-LIST-4). */
export const retryList = async (): Promise<void> => {
  const current = state();

  if (current.rows.length > 0) {
    await loadNextPage();

    return;
  }

  await reloadList(current.scope, current.unread);
};
