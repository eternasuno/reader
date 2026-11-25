import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeItem,
  makePage,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('local saved pages: newest order', () => {
  it('prepends in newest order and removes saved pages locally with unread bookkeeping', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    state.insertSavedPageLocal(makePage({ id: 'p2', title: 'Fresh' }));
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p2', 'p1']);
    expect(state.savedUnreadCount()).toBe(2);

    state.insertSavedPageLocal(makePage({ id: 'p2', title: 'Fresh' }));
    solid.flush();
    expect(state.rows()).toHaveLength(2);
    expect(state.savedUnreadCount()).toBe(2);

    state.removeSavedPageLocal('p2');
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p1']);
    expect(state.savedUnreadCount()).toBe(1);

    state.removeSavedPageLocal('missing');
    solid.flush();
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('local saved pages: oldest order', () => {
  it('appends in oldest order only when the final page is loaded', async () => {
    localStorage.setItem('reader.listOrder', 'oldest');
    await ctx.fresh();
    const { state, solid } = ctx;

    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
      cursor: 'p1',
      feeds: [],
      saved: 0,
    });
    expect(state.activeOrder()).toBe('oldest');

    state.insertSavedPageLocal(makePage({ id: 'p3', title: 'Newest' }));
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p1']);
    expect(state.savedUnreadCount()).toBe(1);

    ctx.queue({
      items: [makePage({ id: 'p2' }), makePage({ id: 'p3', title: 'Newest' })],
      cursor: null,
    });
    await state.loadNextPage();
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2', 'p3']);

    state.insertSavedPageLocal(makePage({ id: 'p4', title: 'Latest' }));
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(state.savedUnreadCount()).toBe(2);
  });
});

describe('local inserts outside scope', () => {
  it('skips local saved-page inserts outside the saved-page scope', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
    });

    state.insertSavedPageLocal(makePage({ id: 'p2' }));
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
  });
});
