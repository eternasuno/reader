import type { Article, ArticlePage, Filter, Scope } from '../lib/library';
import type { LibraryState } from './library-state';

export const resetList = (
  state: LibraryState,
  scope: Scope,
  filter: Filter
): LibraryState => ({
  ...state,
  scope,
  filter,
  items: [],
  loading: true,
  refreshing: false,
  initialized: false,
  hasMore: false,
  cursor: null,
  boundary: null,
  cursorInvalid: false,
  error: undefined,
  generation: state.generation + 1,
});

export const startLoadMore = (state: LibraryState): LibraryState => ({
  ...state,
  loading: true,
  error: undefined,
});

export const failList = (
  state: LibraryState,
  error: string,
  generation: number,
  cursorInvalid = false
): LibraryState =>
  state.generation === generation
    ? { ...state, loading: false, error, cursorInvalid }
    : state;

const mergeNewItems = (
  state: LibraryState,
  incoming: ReadonlyArray<Article>
): ReadonlyArray<Article> => {
  const known = new Set(state.items.map((item) => item.id));
  const added: Array<Article> = [];
  for (const item of incoming) {
    if (known.has(item.id) || state.pending.has(item.id)) {
      continue;
    }

    known.add(item.id);
    added.push(item);
  }

  return added;
};

export const applyPage = (
  state: LibraryState,
  page: ArticlePage,
  generation: number
): LibraryState => {
  if (state.generation !== generation) {
    return state;
  }

  const added = mergeNewItems(state, page.items);

  return {
    ...state,
    items: added.length === 0 ? state.items : [...state.items, ...added],
    cursor: page.cursor,
    boundary: page.boundary ?? state.boundary,
    hasMore: page.cursor !== null,
    initialized: true,
    loading: false,
    cursorInvalid: false,
    error: undefined,
  };
};
