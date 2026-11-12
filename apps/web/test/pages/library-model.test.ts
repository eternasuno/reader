import { describe, expect, it } from 'vitest';
import {
  removeItem,
  setItemsRead,
  upsertItem,
} from '../../src/pages/library-articles';
import { clearScopeCounts, unreadCount } from '../../src/pages/library-counts';
import { applyPage } from '../../src/pages/library-pages';
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

describe('library list merging', () => {
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
