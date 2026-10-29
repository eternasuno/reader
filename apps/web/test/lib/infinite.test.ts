import { describe, expect, it } from 'vitest';
import {
  appendPage,
  applyLoadedRead,
  applyReadAll,
  beginLoad,
  beginReset,
  failLoad,
  type InfiniteState,
  initialInfiniteState,
  prependLoaded,
  removeLoaded,
} from '../../src/lib/infinite';

type Item = {
  readonly key: string;
  readonly createdAt: string;
  readonly read: boolean;
};

const item = (index: number, read = false): Item => ({
  key: `item-${index}`,
  createdAt: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
  read,
});

const keyOf = (entry: Item) => entry.key;
const cursorOf = (entry: Item) => ({
  before: entry.createdAt,
  beforeKey: entry.key,
});
const loaded = (items: readonly Item[]): InfiniteState<Item> =>
  appendPage(
    { ...initialInfiniteState<Item>(), loading: true },
    { items, hasMore: true },
    keyOf,
    cursorOf,
    0
  );

describe('infinite page accumulation', () => {
  it('appends pages, deduplicates keys, and advances the cursor', () => {
    const first = [item(1), item(2), item(3)];
    const second = [item(3), item(4), item(5)];
    const initial = appendPage(
      initialInfiniteState<Item>(),
      { items: first, hasMore: true },
      keyOf,
      cursorOf,
      0
    );
    const appended = appendPage(
      initial,
      { items: second, hasMore: false },
      keyOf,
      cursorOf,
      0
    );

    expect(appended.items.map(keyOf)).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-4',
      'item-5',
    ]);
    expect(appended.items[0]).toBe(first[0]);
    expect(appended.cursor).toEqual(cursorOf(second[2]!));
    expect(appended.hasMore).toBe(false);
    expect(appended.loading).toBe(false);
    expect(appended.initialized).toBe(true);
  });

  it('keeps the same state when a pending request already exists', () => {
    const loading = beginLoad({ ...loaded([item(1)]), hasMore: true });
    const repeated = beginLoad(loading);

    expect(loading.loading).toBe(true);
    expect(repeated).toBe(loading);
  });
});

describe('infinite resets and stale pages', () => {
  it('resets the cursor and ignores pages from an older generation', () => {
    const current = loaded([item(1), item(2)]);
    const reset = beginReset(current);
    const stale = appendPage(
      reset,
      { items: [item(9)], hasMore: false },
      keyOf,
      cursorOf,
      current.generation
    );

    expect(reset.items).toEqual([]);
    expect(reset.cursor).toBeUndefined();
    expect(reset.generation).toBe(current.generation + 1);
    expect(stale).toBe(reset);
  });

  it('ignores stale errors but records the current generation error', () => {
    const current = loaded([item(1)]);
    const reset = beginReset(current);
    const stale = failLoad(reset, 'stale', current.generation);
    const failed = failLoad(reset, '请求失败', reset.generation);

    expect(stale).toBe(reset);
    expect(failed.error).toBe('请求失败');
    expect(failed.loading).toBe(false);
  });

  it('clears errors for an explicit retry', () => {
    const failed = failLoad(loaded([item(1)]), '请求失败', 0);
    const retried = beginLoad(failed);

    expect(retried.error).toBeUndefined();
    expect(retried.loading).toBe(true);
  });
});

describe('infinite loaded marks', () => {
  it('marks loaded keys in place without changing pagination', () => {
    const first = [item(1), item(2), item(3)];
    const state = loaded(first);
    const result = applyLoadedRead(
      state,
      [first[1]?.key ?? 'missing'],
      keyOf,
      state.generation
    );

    expect(result.items.map(keyOf)).toEqual([
      first[0]?.key,
      first[1]?.key,
      first[2]?.key,
    ]);
    expect(result.items[0]).toBe(first[0]);
    expect(result.items[1]?.read).toBe(true);
    expect(result.items[2]).toBe(first[2]);
    expect(result.cursor).toBe(state.cursor);
    expect(result.hasMore).toBe(state.hasMore);
    expect(result.generation).toBe(state.generation);
  });

  it('ignores stale generations and unknown keys', () => {
    const first = [item(1), item(2)];
    const state = loaded(first);

    expect(applyLoadedRead(state, ['missing'], keyOf, state.generation)).toBe(
      state
    );
    expect(
      applyLoadedRead(state, [first[1]?.key ?? ''], keyOf, state.generation - 1)
    ).toBe(state);
  });
});

describe('infinite local mutations', () => {
  it('removes loaded keys and prepends new keys without duplication', () => {
    const current = loaded([item(1), item(2)]);
    const removed = removeLoaded(current, 'item-1', keyOf);
    const prepended = prependLoaded(removed, item(3), keyOf);
    const duplicate = prependLoaded(prepended, item(3), keyOf);

    expect(removed.items.map(keyOf)).toEqual(['item-2']);
    expect(removed.generation).toBe(current.generation + 1);
    expect(prepended.items.map(keyOf)).toEqual(['item-3', 'item-2']);
    expect(duplicate).toBe(prepended);
  });

  it('clears an unread scope and keeps all items in the full scope', () => {
    const current = loaded([item(1), item(2, true), item(3)]);
    const unread = applyReadAll(current, true, () => true, true);
    const full = applyReadAll(current, false, () => true, true);

    expect(unread.items).toEqual([]);
    expect(unread.hasMore).toBe(false);
    expect(unread.cursor).toBeUndefined();
    expect(full.items.map((entry) => entry.read)).toEqual([true, true, true]);
    expect(full.items[1]).not.toBe(current.items[1]);
    expect(full.hasMore).toBe(current.hasMore);
    expect(unread.generation).toBe(current.generation + 1);
  });
});
