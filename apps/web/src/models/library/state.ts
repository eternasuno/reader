import type { Article, Counts, Feed, Folder, Scope } from '../../api/library';
import { emptyCounts } from './counts';

export type LibraryToast = {
  readonly kind: 'success' | 'error';
  readonly message: string;
};

export type LibraryState = {
  readonly scope: Scope;
  readonly unreadOnly: boolean;
  readonly items: ReadonlyArray<Article>;
  readonly feeds: ReadonlyArray<Feed>;
  readonly folders: ReadonlyArray<Folder>;
  readonly counts: Counts;
  readonly loading: boolean;
  readonly initialized: boolean;
  readonly cursor: string | null;
  readonly generation: number;
  readonly error: string | undefined;
  readonly toast: LibraryToast | undefined;
  readonly selected: Article | undefined;
  readonly pending: ReadonlySet<string>;
  /** True while a scope-wide mark-all write is in flight. */
  readonly pendingScopeWrite: boolean;
};

export const initialLibraryState = (
  scope: Scope = { kind: 'later' },
  unreadOnly = false
): LibraryState => ({
  scope,
  unreadOnly,
  items: [],
  feeds: [],
  folders: [],
  counts: emptyCounts,
  loading: false,
  initialized: false,
  cursor: null,
  generation: 0,
  error: undefined,
  toast: undefined,
  selected: undefined,
  pending: new Set(),
  pendingScopeWrite: false,
});

export const isBusy = (state: LibraryState): boolean =>
  state.loading || state.pending.size > 0 || state.pendingScopeWrite;

export const sameScope = (left: Scope, right: Scope): boolean => {
  if (left.kind === 'later') {
    return right.kind === 'later';
  }

  if (left.kind === 'folder') {
    return right.kind === 'folder' && left.folderId === right.folderId;
  }

  return right.kind === 'feeds' && left.feedId === right.feedId;
};

const withPending = (
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

const withoutPending = (
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
