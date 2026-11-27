import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
  savedOrder,
  uuid,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('optimistic read toggle', () => {
  it('marks a row read optimistically and keeps it under the unread filter', async () => {
    const { state, solid } = ctx;
    const items = [makePage({ id: uuid(1018) })];
    ctx.queue(savedOrder(items, B));
    ctx.queue({ items });
    await state.loadScopeFirstPage({ kind: 'later' }, true);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead(uuid(1018), true)).resolves.toBe(true);
    solid.flush();

    expect(state.rows()).toHaveLength(1);
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.requestUrl(before)).toBe(`/api/saved-pages/${uuid(1018)}`);
    expect(ctx.requestInit(before).method).toBe('PATCH');
    expect(ctx.requestBody(before)).toEqual({ read: true });
  });
});

describe('feed item read toggle', () => {
  it('marks a feed item read through the feed-items endpoint', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [makeFeed({ id: uuid(1001) })],
      counts: [{ feedId: uuid(1001), count: 1 }],
    });

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead(uuid(1007), true)).resolves.toBe(true);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe(`/api/feed-items/${uuid(1007)}`);
    expect(state.feedUnreadCount(uuid(1001))).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('read no-op', () => {
  it('is a no-op when the read state already matches', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: true })],
    });

    await expect(state.toggleArticleRead(uuid(1018), true)).resolves.toBe(true);
    expect(ctx.fetchCount()).toBe(2);
  });
});

describe('read toggle rollback', () => {
  it('restores the confirmed state and counts of a failed read toggle', async () => {
    const { state, solid, ui, i18n } = ctx;
    const items = [makePage({ id: uuid(1018) })];
    ctx.queue(savedOrder(items, B));
    ctx.queue({ items });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    const req = ctx.pending();
    const before = ctx.fetchCount();
    const toggling = state.toggleArticleRead(uuid(1018), true);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);

    req.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(toggling).resolves.toBe(false);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe(`/api/saved-pages/${uuid(1018)}`);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SavedPageRepositoryError')
    );
  });
});

describe('mark loaded read', () => {
  it('marks every loaded unread row read in one batch', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1001) }),
        makeItem({ id: uuid(1009), feedId: uuid(1001), read: true }),
      ],
      feeds: [makeFeed({ id: uuid(1001) })],
      counts: [{ feedId: uuid(1001), count: 2 }],
    });

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    state.markLoadedRead();
    solid.flush();
    await vi.waitFor(() => expect(ctx.fetchCount()).toBe(before + 1));

    expect(ctx.requestUrl(before)).toBe('/api/feed-items/read');
    expect(ctx.requestBody(before)).toEqual({ ids: [uuid(1007), uuid(1008)] });
    expect(state.rows().every((row) => row.read)).toBe(true);
    expect(state.feedUnreadCount(uuid(1001))).toBe(0);

    const afterBatch = ctx.fetchCount();
    state.markLoadedRead();
    expect(ctx.fetchCount()).toBe(afterBatch);
  });
});

describe('mark loaded read rollback', () => {
  it('rolls back a failed mark-loaded-read', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018) })],
      saved: 1,
    });

    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    state.markLoadedRead();
    await vi.waitFor(() => expect(ui.currentToast()).not.toBeNull());
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
