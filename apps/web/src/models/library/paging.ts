import type { Article, ArticlePage, Scope } from '../../api/library';
import type { LibraryState } from './state';

export const resetList = (
  state: LibraryState,
  scope: Scope,
  unreadOnly: boolean
): LibraryState => ({
  ...state,
  scope,
  unreadOnly,
  items: [],
  loading: true,
  initialized: false,
  cursor: null,
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
  generation: number
): LibraryState =>
  state.generation === generation ? { ...state, loading: false, error } : state;

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
    initialized: true,
    loading: false,
    error: undefined,
  };
};
