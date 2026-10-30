export type PageCursor = {
  readonly before: string;
  readonly beforeKey: string;
};

export type InfinitePage<T> = {
  readonly items: readonly T[];
  readonly hasMore: boolean;
};

export type InfiniteState<T> = {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly generation: number;
  readonly cursor: PageCursor | undefined;
};

export type KeyOf<T> = (item: T) => string;

export type CursorOf<T> = (item: T) => PageCursor;

export const initialInfiniteState = <T>(): InfiniteState<T> => ({
  items: [],
  hasMore: true,
  initialized: false,
  loading: false,
  error: undefined,
  generation: 0,
  cursor: undefined,
});

export const beginReset = <T>(state: InfiniteState<T>): InfiniteState<T> => ({
  items: [],
  hasMore: true,
  initialized: false,
  loading: true,
  error: undefined,
  generation: state.generation + 1,
  cursor: undefined,
});

export const beginLoad = <T>(state: InfiniteState<T>): InfiniteState<T> => {
  if (state.loading || !state.hasMore) {
    return state;
  }

  return { ...state, loading: true, error: undefined };
};

export const appendPage = <T>(
  state: InfiniteState<T>,
  page: InfinitePage<T>,
  keyOf: KeyOf<T>,
  cursorOf: CursorOf<T>,
  generation: number
): InfiniteState<T> => {
  if (state.generation !== generation) {
    return state;
  }

  const keys = new Set(state.items.map(keyOf));
  const added = page.items.filter((item) => {
    const key = keyOf(item);
    if (keys.has(key)) {
      return false;
    }

    keys.add(key);

    return true;
  });
  const last = page.items[page.items.length - 1];

  return {
    ...state,
    items: added.length === 0 ? state.items : [...state.items, ...added],
    hasMore: page.hasMore,
    initialized: true,
    loading: false,
    error: undefined,
    cursor: last ? cursorOf(last) : state.cursor,
  };
};

export const failLoad = <T>(
  state: InfiniteState<T>,
  error: string,
  generation: number
): InfiniteState<T> =>
  state.generation === generation ? { ...state, loading: false, error } : state;

export const removeLoaded = <T>(
  state: InfiniteState<T>,
  key: string,
  keyOf: KeyOf<T>
): InfiniteState<T> => {
  const items = state.items.filter((item) => keyOf(item) !== key);

  return items.length === state.items.length
    ? state
    : {
        ...state,
        items,
        loading: false,
        generation: state.generation + 1,
      };
};

export const prependLoaded = <T>(
  state: InfiniteState<T>,
  item: T,
  keyOf: KeyOf<T>
): InfiniteState<T> =>
  state.items.some((candidate) => keyOf(candidate) === keyOf(item))
    ? state
    : {
        ...state,
        items: [item, ...state.items],
        initialized: true,
        error: undefined,
      };

export const applyLoadedRead = <T extends { readonly read: boolean }>(
  state: InfiniteState<T>,
  keys: readonly string[],
  keyOf: KeyOf<T>,
  generation: number
): InfiniteState<T> => {
  if (state.generation !== generation || keys.length === 0) return state;

  const marked = new Set(keys);
  let changed = false;
  const items = state.items.map((item) => {
    if (item.read || !marked.has(keyOf(item))) return item;
    changed = true;

    return { ...item, read: true };
  });

  return changed ? { ...state, items } : state;
};

export const applyReadAll = <T extends { readonly read: boolean }>(
  state: InfiniteState<T>,
  onlyUnread: boolean,
  matches: (item: T) => boolean,
  completeScope: boolean
): InfiniteState<T> => {
  const items = onlyUnread
    ? state.items.filter((item) => !matches(item))
    : state.items.map((item) =>
        matches(item) ? { ...item, read: true } : item
      );
  const exhausted = onlyUnread && completeScope;

  return {
    ...state,
    items,
    hasMore: exhausted ? false : state.hasMore,
    cursor: exhausted ? undefined : state.cursor,
    initialized: true,
    loading: false,
    error: undefined,
    generation: state.generation + 1,
  };
};
