import type { Article, Counts, Feed, Filter, Scope } from '../lib/library';
import { emptyCounts } from './library-counts';

export type LibraryToast = {
  readonly kind: 'success' | 'error';
  readonly message: string;
};

export type LibraryState = {
  readonly scope: Scope;
  readonly filter: Filter;
  readonly items: readonly Article[];
  readonly feeds: readonly Feed[];
  readonly counts: Counts;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly initialized: boolean;
  readonly hasMore: boolean;
  readonly cursor: string | null;
  readonly boundary: string | null;
  readonly generation: number;
  readonly cursorInvalid: boolean;
  readonly error: string | undefined;
  readonly toast: LibraryToast | undefined;
  readonly selected: Article | undefined;
  readonly pending: ReadonlySet<string>;
};

export const initialLibraryState = (
  scope: Scope = { kind: 'later' },
  filter: Filter = 'all'
): LibraryState => ({
  scope,
  filter,
  items: [],
  feeds: [],
  counts: emptyCounts,
  loading: false,
  refreshing: false,
  initialized: false,
  hasMore: false,
  cursor: null,
  boundary: null,
  generation: 0,
  cursorInvalid: false,
  error: undefined,
  toast: undefined,
  selected: undefined,
  pending: new Set(),
});

export const sameScope = (left: Scope, right: Scope): boolean => {
  if (left.kind === 'later') {
    return right.kind === 'later';
  }

  return right.kind === 'feeds' && left.feedId === right.feedId;
};

export const withPending = (
  pending: ReadonlySet<string>,
  id: string
): ReadonlySet<string> => {
  if (pending.has(id)) {
    return pending;
  }

  const next = new Set(pending);
  next.add(id);

  return next;
};

export const withoutPending = (
  pending: ReadonlySet<string>,
  id: string
): ReadonlySet<string> => {
  if (!pending.has(id)) {
    return pending;
  }

  const next = new Set(pending);
  next.delete(id);

  return next;
};

export const addPending = (state: LibraryState, id: string): LibraryState => ({
  ...state,
  pending: withPending(state.pending, id),
});

export const dropPending = (state: LibraryState, id: string): LibraryState => ({
  ...state,
  pending: withoutPending(state.pending, id),
});

export const findArticle = (
  state: LibraryState,
  id: string
): Article | undefined => {
  const row = state.items.find((item) => item.id === id);

  return row ?? (state.selected?.id === id ? state.selected : undefined);
};
