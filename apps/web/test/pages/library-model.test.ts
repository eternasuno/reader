// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped transition cases stay together with their shared page fixture.
import { describe, expect, it } from 'vitest';
import {
  removeItem,
  restoreItem,
  setItemsRead,
  upsertItem,
} from '../../src/pages/library-articles';
import { clearScopeCounts, unreadCount } from '../../src/pages/library-counts';
import {
  applyPage,
  failList,
  resetList,
  startLoadMore,
} from '../../src/pages/library-pages';
import {
  initialLibraryState,
  type LibraryState,
} from '../../src/pages/library-state';
import { article, counts, page } from './library-fixtures';

const loaded = () =>
  applyPage(
    { ...initialLibraryState(), loading: true },
    page([article('a'), article('b')], 'cursor-1'),
    0
  );

describe('library list transitions', () => {
  it('advances the cursor with every loaded page', () => {
    const first = loaded();
    expect(first.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(first.cursor).toBe('cursor-1');
    expect(first.hasMore).toBe(true);

    const next = applyPage(
      first,
      page([article('b'), article('c')], null),
      first.generation
    );
    expect(next.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(next.cursor).toBeNull();
    expect(next.hasMore).toBe(false);
  });

  it('does not re-add rows whose deletion is still pending', () => {
    const removed = removeItem(loaded(), article('b'));
    const pending = { ...removed, pending: new Set(['b']) };
    const merged = applyPage(
      pending,
      page([article('b'), article('c')]),
      pending.generation
    );

    expect(merged.items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('keeps optimistic read rows when the page repeats them', () => {
    const optimistic = setItemsRead(loaded(), new Set(['a']), true);
    const merged = applyPage(
      optimistic,
      page([article('a'), article('b')]),
      optimistic.generation
    );

    expect(merged.items[0]?.read).toBe(true);
    expect(merged.items).toHaveLength(2);
  });
});

describe('library list failures', () => {
  it('ignores a page from a previous generation', () => {
    const state = loaded();

    expect(applyPage(state, page([article('c')]), 99)).toBe(state);
    expect(applyPage(state, page([article('c')]), state.generation + 1)).toBe(
      state
    );
  });

  it('records load failures and keeps the retry cursor', () => {
    const state = loaded();
    const loading = startLoadMore(state);
    const failed = failList(loading, '暂时无法读取文章，请稍后重试', 0);

    expect(failed.loading).toBe(false);
    expect(failed.error).toBe('暂时无法读取文章，请稍后重试');
    expect(failed.cursor).toBe('cursor-1');
    expect(failList(loading, 'stale', 99)).toBe(loading);
    expect(resetList(state, { kind: 'later' }, 'all')).toMatchObject({
      loading: true,
      initialized: false,
      cursor: null,
      generation: state.generation + 1,
    });
  });
});

describe('library read counts', () => {
  it('moves later and feed unread counts with each row', () => {
    const state = applyPage(
      {
        ...initialLibraryState(),
        loading: true,
        counts: counts(2, { f1: 1 }),
      },
      page([article('a', { feedId: 'f1' }), article('b')]),
      0
    );
    const read = setItemsRead(state, new Set(['a', 'b']), true);

    expect(read.counts).toEqual({ later: 1, feeds: { f1: 0 }, feedsTotal: 0 });
    expect(setItemsRead(read, new Set(['a', 'b']), false).counts).toEqual(
      counts(2, { f1: 1 })
    );
    expect(setItemsRead(read, new Set(['a']), true)).toBe(read);
  });

  it('keeps the selected article in sync', () => {
    const state = { ...loaded(), selected: article('a') };
    const read = setItemsRead(state, new Set(['a']), true);

    expect(read.selected?.read).toBe(true);
    expect(read.items[0]?.read).toBe(true);
  });
});

describe('library scope counts', () => {
  it('clears the unread counts of the active scope', () => {
    const state = {
      ...initialLibraryState(),
      counts: counts(2, { f1: 1, f2: 3 }),
    };

    expect(unreadCount(state.counts, { kind: 'later' })).toBe(2);
    expect(unreadCount(state.counts, { kind: 'feeds' })).toBe(4);
    expect(unreadCount(state.counts, { kind: 'feeds', feedId: 'f1' })).toBe(1);
    expect(clearScopeCounts(state.counts, { kind: 'feeds' })).toEqual(
      counts(2)
    );
    expect(
      clearScopeCounts(state.counts, { kind: 'feeds', feedId: 'f1' })
    ).toEqual({ later: 2, feeds: { f1: 0, f2: 3 }, feedsTotal: 3 });
    expect(clearScopeCounts(state.counts, { kind: 'later' }).later).toBe(0);
  });
});

describe('library row transitions', () => {
  it('inserts, replaces, and restores rows with their counts', () => {
    const state = { ...loaded(), counts: counts(3) };
    const inserted = upsertItem(state, article('n'));
    expect(inserted.items.map((item) => item.id)).toEqual(['n', 'a', 'b']);

    const removed = removeItem(inserted, inserted.items[0] ?? article('n'));
    expect(removed.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(removed.counts.later).toBe(2);
    expect(restoreItem(removed, article('n'), 0).counts.later).toBe(3);
    expect(restoreItem(removed, removed.items[0] ?? article('a'), 0)).toBe(
      removed
    );
  });

  it('leaves rows outside the active scope untouched', () => {
    const state: LibraryState = {
      ...loaded(),
      scope: { kind: 'feeds', feedId: 'f1' },
    };
    const outside = upsertItem(state, article('x', { feedId: 'f2' }));

    expect(outside.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(upsertItem(state, article('y', { feedId: 'f1' })).items[0]?.id).toBe(
      'y'
    );
  });
});
