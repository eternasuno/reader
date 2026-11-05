// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped refresh cases stay together with their shared page fixture.
import { describe, expect, it } from 'vitest';
import { setItemsRead } from '../../src/pages/library-articles';
import { applyPage } from '../../src/pages/library-pages';
import {
  applyRefresh,
  applyRefreshPage,
} from '../../src/pages/library-refresh';
import { initialLibraryState } from '../../src/pages/library-state';
import { article, counts, page } from './library-fixtures';

const loaded = () =>
  applyPage(
    { ...initialLibraryState(), loading: true },
    page([article('a'), article('b')], 'cursor-1', 'boundary-1'),
    0
  );

describe('library bounded refresh', () => {
  it('drops covered rows the server no longer returns', () => {
    const state = { ...loaded(), counts: counts(2) };
    const synced = applyRefresh(state, [article('a')], state.generation);

    expect(synced.items.map((item) => item.id)).toEqual(['a']);
    expect(synced.counts.later).toBe(1);
  });

  it('keeps server order instead of prepending a backdated discovery', () => {
    const state = applyPage(
      { ...initialLibraryState(), loading: true },
      page(
        [
          article('a', { publishedAt: '2026-01-02T00:00:00.000Z' }),
          article('c', { publishedAt: '2026-01-01T00:00:00.000Z' }),
        ],
        'cursor-1',
        'boundary-1'
      ),
      0
    );
    const synced = applyRefresh(
      state,
      [
        article('n', { publishedAt: '2026-01-03T00:00:00.000Z' }),
        article('a', { publishedAt: '2026-01-02T00:00:00.000Z' }),
        article('old', { publishedAt: '2026-01-01T12:00:00.000Z' }),
      ],
      state.generation
    );

    expect(synced.items.map((item) => item.id)).toEqual(['n', 'a', 'old']);
  });

  it('retains pending rows the server does not return yet', () => {
    const state = {
      ...setItemsRead(loaded(), new Set(['a']), true),
      pending: new Set(['a']),
    };
    const synced = applyRefresh(state, [article('b')], state.generation);

    expect(synced.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(synced.items[0]?.read).toBe(true);
  });

  it('keeps rows loaded after the request outside the covered range', () => {
    const state = applyPage(
      loaded(),
      page([article('c')], 'cursor-2', 'boundary-2'),
      0
    );
    const synced = applyRefresh(
      state,
      [article('a'), article('b')],
      state.generation,
      new Set(['a', 'b'])
    );

    expect(synced.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces covered first-page rows that disappeared', () => {
    const state = applyPage(
      { ...initialLibraryState(), loading: true },
      page([article('a'), article('b')], null, null),
      0
    );
    const synced = applyRefreshPage(
      state,
      page([article('b')], 'cursor-2', 'boundary-2'),
      state.generation
    );

    expect(synced.items.map((item) => item.id)).toEqual(['b']);
    expect(synced.cursor).toBe('cursor-2');
    expect(synced.boundary).toBe('boundary-2');
  });
});
