import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeItem,
  makePage,
  savedOrder,
  uuid,
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
      items: [makePage({ id: uuid(1018), read: true })],
    });
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    state.insertSavedPageLocal(makePage({ id: uuid(1019), title: 'Fresh' }));
    solid.flush();
    expect(state.rowIds()).toEqual([uuid(1019), uuid(1018)]);
    expect(state.savedUnreadCount()).toBe(2);
    expect(state.listRevision()).toBe(2);

    state.insertSavedPageLocal(makePage({ id: uuid(1019), title: 'Fresh' }));
    solid.flush();
    expect(state.rowIds()).toHaveLength(2);
    expect(state.savedUnreadCount()).toBe(2);
    expect(state.listRevision()).toBe(2);

    state.removeSavedPageLocal(uuid(1019));
    solid.flush();
    expect(state.rowIds()).toEqual([uuid(1018)]);
    expect(state.savedUnreadCount()).toBe(1);
    expect(state.listRevision()).toBe(3);

    state.removeSavedPageLocal(uuid(1015));
    solid.flush();
    expect(state.rowIds()).toEqual([uuid(1018)]);
    expect(state.savedUnreadCount()).toBe(1);
    expect(state.listRevision()).toBe(4);
  });
});

describe('local changes during a saved-page batch', () => {
  it('prepends and deduplicates the new page and ignores a deleted ID in a late batch', async () => {
    const { state } = ctx;
    const fresh = makePage({ id: uuid(3), title: 'Fresh' });
    const deleted = makePage({ id: uuid(2) });
    const older = makePage({ id: uuid(1) });
    ctx.queue(savedOrder([fresh, deleted, older]));
    const batch = ctx.pending();
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    state.requestWindow({ start: 0, end: 0 });
    expect(ctx.fetchCount()).toBe(2);

    state.insertSavedPageLocal(fresh);
    state.insertSavedPageLocal(fresh);
    state.removeSavedPageLocal(deleted.id);
    batch.resolve(
      jsonResponse({ items: [{ ...fresh, title: 'Stale' }, deleted, older] })
    );
    await vi.waitFor(() => expect(state.articleById(older.id)).not.toBeNull());
    expect(state.rowIds()).toEqual([fresh.id, older.id]);
    expect(state.articleById(fresh.id)?.title).toBe('Fresh');
    expect(state.articleById(deleted.id)).toBeNull();
  });
});

describe('local inserts outside scope', () => {
  it('skips local saved-page inserts outside the saved-page scope', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
    });

    state.insertSavedPageLocal(makePage({ id: uuid(1019) }));
    solid.flush();

    expect(state.rowIds()).toEqual([uuid(1007)]);
  });
});
