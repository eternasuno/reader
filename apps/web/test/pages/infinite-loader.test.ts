import { describe, expect, it } from 'vitest';
import {
  appendPage,
  type InfiniteState,
  initialInfiniteState,
} from '../../src/lib/infinite';
import { useInfiniteLoader } from '../../src/pages/infinite-loader';

type Item = {
  readonly key: string;
  readonly createdAt: string;
};

const first: Item = {
  key: 'item-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const keyOf = (item: Item) => item.key;
const cursorOf = (item: Item) => ({
  before: item.createdAt,
  beforeKey: item.key,
});
const loaded = (): InfiniteState<Item> =>
  appendPage(
    initialInfiniteState<Item>(),
    { items: [first], hasMore: true },
    keyOf,
    cursorOf,
    0
  );

const stateHolder = (initial: InfiniteState<Item>) => {
  let current = initial;

  return {
    read: () => current,
    write: (next: InfiniteState<Item>) => {
      current = next;
    },
  };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const recordingLoader = (
  state: () => InfiniteState<Item>,
  pending: () => boolean = () => false
) => {
  const calls: boolean[] = [];
  let gate = deferred();
  const loader = useInfiniteLoader(state, pending, (reset) => {
    calls.push(reset);

    return gate.promise;
  });

  return {
    loader,
    calls,
    resolve: () => {
      gate.resolve();
      gate = deferred();
    },
  };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('infinite loader concurrency', () => {
  it('runs one append request at a time and releases the guard', async () => {
    const state = stateHolder(loaded());
    const { loader, calls, resolve } = recordingLoader(state.read);

    loader.loadMore();
    loader.loadMore();
    loader.loadMore();

    expect(calls).toEqual([false]);
    resolve();
    await flush();
    loader.loadMore();

    expect(calls).toEqual([false, false]);
  });

  it('lets a reset supersede an append request', () => {
    const state = stateHolder(loaded());
    const { loader, calls } = recordingLoader(state.read);

    loader.loadMore();
    loader.reload();

    expect(calls).toEqual([false, true]);
  });
});

describe('infinite loader state guards', () => {
  it('does not request more while blocked by state', () => {
    const blockedStates: InfiniteState<Item>[] = [
      { ...loaded(), error: '请求失败' },
      { ...loaded(), loading: true },
      { ...loaded(), hasMore: false },
    ];

    for (const state of blockedStates) {
      const holder = stateHolder(state);
      const { loader, calls } = recordingLoader(holder.read);

      loader.loadMore();

      expect(calls).toEqual([]);
    }
  });

  it('does not request more while a mutation is pending', () => {
    const state = stateHolder(loaded());
    const { loader, calls } = recordingLoader(state.read, () => true);

    loader.loadMore();

    expect(calls).toEqual([]);
  });
});

describe('infinite loader retry guards', () => {
  it('does not retry while a page is loading', async () => {
    const state = stateHolder({ ...loaded(), loading: true });
    const { loader, calls } = recordingLoader(state.read);

    loader.retry();
    await flush();

    expect(calls).toEqual([]);
  });

  it('does not retry while an append request is in flight', () => {
    const state = stateHolder(loaded());
    const { loader, calls } = recordingLoader(state.read);

    loader.loadMore();
    loader.retry();

    expect(calls).toEqual([false]);
  });
});

describe('infinite loader retries', () => {
  it('resets before the first page and appends afterwards', async () => {
    const state = stateHolder(initialInfiniteState<Item>());
    const { loader, calls } = recordingLoader(state.read);

    loader.retry();
    await flush();
    state.write(loaded());
    loader.retry();
    await flush();

    expect(calls).toEqual([true, false]);
  });

  it('absorbs rejected page loads without leaving the guard set', async () => {
    let attempts = 0;
    const state = stateHolder(loaded());
    const loader = useInfiniteLoader(
      state.read,
      () => false,
      () => {
        attempts += 1;

        return Promise.reject(new Error('network'));
      }
    );

    expect(() => loader.loadMore()).not.toThrow();
    await flush();
    loader.loadMore();

    expect(attempts).toBe(2);
  });

  it('absorbs synchronously throwing page loads', async () => {
    let attempts = 0;
    const state = stateHolder(loaded());
    const loader = useInfiniteLoader(
      state.read,
      () => false,
      () => {
        attempts += 1;
        throw new Error('synchronous');
      }
    );

    expect(() => loader.loadMore()).not.toThrow();
    await flush();
    loader.loadMore();

    expect(attempts).toBe(2);
  });
});

describe('infinite loader periodic reload', () => {
  it('reloads while a mutation is pending so scheduled refreshes are not lost', () => {
    const state = stateHolder(loaded());
    const { loader, calls } = recordingLoader(state.read, () => true);

    loader.reload();

    expect(calls).toEqual([true]);
  });
});
