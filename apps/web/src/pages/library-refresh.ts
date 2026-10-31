import type { Article, ArticlePage, Counts } from '../lib/library';
import { withReadCount } from './library-counts';
import type { LibraryState } from './library-state';

const compareArticles = (left: Article, right: Article): number => {
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt > right.publishedAt ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? -1 : 1;
};

const insertByOrder = (items: Article[], article: Article) => {
  const index = items.findIndex((item) => compareArticles(article, item) < 0);
  if (index < 0) {
    items.push(article);
  } else {
    items.splice(index, 0, article);
  }
};

const mergeServerRefresh = (
  state: LibraryState,
  items: readonly Article[],
  previous: ReadonlyMap<string, Article>
): { readonly items: Article[]; readonly seen: Set<string> } => {
  const seen = new Set<string>();
  const next: Article[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    if (state.pending.has(item.id)) {
      const local = previous.get(item.id);
      if (local !== undefined) {
        next.push(local);
      }
      continue;
    }
    next.push(item);
  }

  return { items: next, seen };
};

const retainRefreshRows = (
  state: LibraryState,
  merged: { items: Article[]; seen: Set<string> },
  covered: ReadonlySet<string>
) => {
  const retained: Article[] = [];
  for (const item of state.items) {
    if (merged.seen.has(item.id)) {
      continue;
    }
    merged.seen.add(item.id);
    if (state.pending.has(item.id)) {
      insertByOrder(merged.items, item);
    } else if (!covered.has(item.id)) {
      retained.push(item);
    }
  }
  merged.items.push(...retained);
};

const removedCounts = (
  counts: Counts,
  previous: ReadonlyMap<string, Article>,
  items: readonly Article[]
): Counts => {
  const finalIds = new Set(items.map((item) => item.id));
  let result = counts;
  for (const [id, item] of previous) {
    if (!finalIds.has(id) && !item.read) {
      result = withReadCount(result, item, true);
    }
  }

  return result;
};

const updatedCounts = (
  counts: Counts,
  previous: ReadonlyMap<string, Article>,
  items: readonly Article[]
): Counts => {
  let result = counts;
  for (const item of items) {
    const prior = previous.get(item.id);
    if (prior === undefined) {
      if (!item.read) {
        result = withReadCount(result, item, false);
      }
    } else if (prior.read !== item.read) {
      result = withReadCount(result, item, item.read);
    }
  }

  return result;
};

const refreshCounts = (
  counts: Counts,
  previous: ReadonlyMap<string, Article>,
  items: readonly Article[]
): Counts =>
  updatedCounts(removedCounts(counts, previous, items), previous, items);

const refreshSelection = (
  state: LibraryState,
  previous: ReadonlyMap<string, Article>,
  items: readonly Article[],
  counts: Counts
): { readonly counts: Counts; readonly selected: Article | undefined } => {
  const selected = state.selected;
  if (selected === undefined || state.pending.has(selected.id)) {
    return { counts, selected };
  }

  const current = items.find((item) => item.id === selected.id);
  if (current === undefined) {
    return { counts, selected };
  }

  const adjusted =
    !previous.has(selected.id) && current.read !== selected.read
      ? withReadCount(counts, current, current.read)
      : counts;

  return { counts: adjusted, selected: current };
};

export const applyRefresh = (
  state: LibraryState,
  items: readonly Article[],
  generation: number,
  covered: ReadonlySet<string> = new Set(state.items.map((item) => item.id))
): LibraryState => {
  if (state.generation !== generation) {
    return { ...state, refreshing: false };
  }

  const previous = new Map(state.items.map((item) => [item.id, item]));
  const merged = mergeServerRefresh(state, items, previous);
  retainRefreshRows(state, merged, covered);
  const counts = refreshCounts(state.counts, previous, merged.items);
  const selection = refreshSelection(state, previous, merged.items, counts);

  return {
    ...state,
    items: merged.items,
    counts: selection.counts,
    selected: selection.selected,
    hasMore: state.cursor !== null,
    refreshing: false,
  };
};

export const applyRefreshPage = (
  state: LibraryState,
  page: ArticlePage,
  generation: number,
  covered: ReadonlySet<string> = new Set(state.items.map((item) => item.id))
): LibraryState => {
  if (state.generation !== generation) {
    return { ...state, refreshing: false };
  }

  const refreshed = applyRefresh(state, page.items, generation, covered);
  const cursor = state.cursor ?? page.cursor;

  return {
    ...refreshed,
    boundary: state.boundary ?? page.boundary,
    cursor,
    hasMore: cursor !== null,
    initialized: true,
    cursorInvalid: false,
  };
};
