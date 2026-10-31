import type { Article, Scope } from '../lib/library';
import { withReadCount } from './library-counts';
import type { LibraryState } from './library-state';

export const setItemsRead = (
  state: LibraryState,
  ids: ReadonlySet<string>,
  read: boolean
): LibraryState => {
  if (ids.size === 0) {
    return state;
  }

  let counts = state.counts;
  let changed = false;
  const items = state.items.map((item) => {
    if (!ids.has(item.id) || item.read === read) {
      return item;
    }
    changed = true;
    counts = withReadCount(counts, item, read);

    return { ...item, read };
  });

  let selected = state.selected;
  if (
    selected !== undefined &&
    ids.has(selected.id) &&
    selected.read !== read
  ) {
    changed = true;
    counts = withReadCount(counts, selected, read);
    selected = { ...selected, read };
  }

  return changed ? { ...state, items, counts, selected } : state;
};

const inScope = (scope: Scope, article: Article): boolean => {
  if (scope.kind === 'later') {
    return article.feedId === undefined;
  }

  return scope.feedId === undefined || scope.feedId === article.feedId;
};

export const upsertItem = (
  state: LibraryState,
  article: Article
): LibraryState => {
  const index = state.items.findIndex((item) => item.id === article.id);
  const previous = index < 0 ? undefined : state.items[index];
  if (previous === undefined && !inScope(state.scope, article)) {
    return state.selected?.id === article.id
      ? { ...state, selected: article }
      : state;
  }

  const counts =
    previous === undefined || previous.read === article.read
      ? state.counts
      : withReadCount(state.counts, article, article.read);
  const items =
    index < 0
      ? [article, ...state.items]
      : state.items.map((item) => (item.id === article.id ? article : item));

  return {
    ...state,
    items,
    counts,
    selected: state.selected?.id === article.id ? article : state.selected,
  };
};

export const removeItem = (
  state: LibraryState,
  article: Article
): LibraryState => ({
  ...state,
  items: state.items.filter((item) => item.id !== article.id),
  counts: article.read
    ? state.counts
    : withReadCount(state.counts, article, true),
  selected: state.selected?.id === article.id ? undefined : state.selected,
});

export const selectSnapshot = (
  state: LibraryState,
  snapshot: Article | undefined
): LibraryState => {
  if (snapshot === undefined) {
    return state.selected === undefined
      ? state
      : { ...state, selected: undefined };
  }

  return state.selected === snapshot ? state : { ...state, selected: snapshot };
};

export const restoreItem = (
  state: LibraryState,
  article: Article,
  index: number
): LibraryState => {
  if (state.items.some((item) => item.id === article.id)) {
    return state;
  }

  const items = [...state.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, article);

  return {
    ...state,
    items,
    counts: article.read
      ? state.counts
      : withReadCount(state.counts, article, false),
  };
};
