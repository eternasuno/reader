import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeItem,
  makePage,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('stale page responses', () => {
  it('discards stale page responses from an earlier scope', async () => {
    const { state, solid } = ctx;
    const first = ctx.pending();
    const slow = state.loadScopeFirstPage({ kind: 'later' }, false);

    ctx.queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    const fast = state.loadScopeFirstPage({ kind: 'all' }, false);
    await fast;
    solid.flush();

    first.resolve(
      jsonResponse({ items: [makePage({ id: 'p1' })], cursor: 'p1' })
    );
    await slow;
    solid.flush();

    expect(state.activeScope()).toEqual({ kind: 'all' });
    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingInitial()).toBe(false);
  });
});

describe('next page guard', () => {
  it('appends the next page, dedupes overlapping IDs, and allows one request in flight', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      cursor: 'p1',
    });

    ctx.queue({
      items: [
        makePage({ id: 'p1', title: 'Duplicate' }),
        makePage({ id: 'p2' }),
      ],
      cursor: null,
    });
    const first = state.loadNextPage();
    const second = state.loadNextPage();
    await Promise.all([first, second]);
    solid.flush();

    expect(ctx.fetchCount()).toBe(2);
    expect(ctx.requestUrl(1)).toBe(
      '/api/saved-pages?limit=30&unread=false&cursor=p1'
    );
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingMore()).toBe(false);

    await state.loadNextPage();
    expect(ctx.fetchCount()).toBe(2);
  });
});

describe('next page failure', () => {
  it('keeps rows and exposes a retry banner when the next page fails', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      cursor: 'p1',
    });

    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    await state.loadNextPage();
    solid.flush();

    expect(state.rows()).toHaveLength(1);
    expect(state.cursor()).toBe('p1');
    expect(state.loadError()).toBe('SavedPageRepositoryError');
    expect(state.loadingMore()).toBe(false);

    ctx.queue({ items: [makePage({ id: 'p2' })], cursor: null });
    await state.retryLoad();
    solid.flush();

    expect(state.loadError()).toBeNull();
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2']);
  });
});

describe('first page retry', () => {
  it('retries page 1 when the initial load failed', async () => {
    const { state, solid } = ctx;
    ctx.queue({ error: 'FeedItemRepositoryError' }, 500);
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    expect(state.rows()).toHaveLength(0);
    expect(state.loadError()).toBe('FeedItemRepositoryError');

    ctx.queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.retryLoad();
    solid.flush();

    expect(state.loadError()).toBeNull();
    expect(state.rows()).toHaveLength(1);
  });
});
