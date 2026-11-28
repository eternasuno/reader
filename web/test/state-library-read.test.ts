import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse,
  loadWindowedScope,
  makeFeed,
  makeItem,
  makePage,
  noContentResponse,
  requireArticle,
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
    await loadWindowedScope(state, { kind: 'later' }, true);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    ctx.queueEmpty();
    const before = ctx.fetchCount();
    await expect(state.toggleArticleRead(uuid(1018), true)).resolves.toBe(true);
    solid.flush();

    expect(state.rowIds()).toHaveLength(1);
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
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
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
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
    await loadWindowedScope(state, { kind: 'later' }, false);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    const req = ctx.pending();
    const before = ctx.fetchCount();
    const toggling = state.toggleArticleRead(uuid(1018), true);
    solid.flush();
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);

    req.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(toggling).resolves.toBe(false);
    solid.flush();

    expect(ctx.requestUrl(before)).toBe(`/api/saved-pages/${uuid(1018)}`);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.articleById(state.rowIds()[0])?.read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SavedPageRepositoryError')
    );
  });
});

describe('mark read above', () => {
  it('marks every cached unread row through the visible end in one batch', async () => {
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
    state.markReadAbove();
    solid.flush();
    await vi.waitFor(() => expect(ctx.fetchCount()).toBe(before + 1));

    expect(ctx.requestUrl(before)).toBe('/api/feed-items/read');
    expect(ctx.requestBody(before)).toEqual({ ids: [uuid(1007), uuid(1008)] });
    expect(
      state.rowIds().every((id) => state.articleById(id)?.read === true)
    ).toBe(true);
    expect(state.feedUnreadCount(uuid(1001))).toBe(0);

    const afterBatch = ctx.fetchCount();
    state.markReadAbove();
    expect(ctx.fetchCount()).toBe(afterBatch);
  });
});

const loadPartiallyCachedFeedList = async (feedId: string) => {
  const { state } = ctx;
  const items = Array.from({ length: 28 }, (_, index) =>
    makeItem({ id: uuid(1100 + index), feedId, read: index === 24 })
  );
  const feeds = [makeFeed({ id: feedId })];
  ctx.queueSidebar({ feeds, counts: [{ feedId, count: 27 }] });
  await state.refreshSidebar();
  ctx.queue(feedOrder(items));
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  ctx.queue({ items: items.slice(5) });
  state.requestWindow({ start: 25, end: 25 });
  await vi.waitFor(() =>
    expect(requireArticle(state, items[25].id).read).toBe(false)
  );

  return { items, feeds };
};

it('marks cached and uncached IDs through the visible end and reconciles counts after drain', async () => {
  const { state, solid } = ctx;
  const { mountSidebarRefresh } = await import('../src/state/sidebar-refresh');
  const feedId = uuid(1001);
  const { items, feeds } = await loadPartiallyCachedFeedList(feedId);
  const before = ctx.fetchCount();
  state.markReadAbove();
  expect(ctx.fetchCount()).toBe(before);
  state.setVisibleRange({ first: 25, last: 25 });
  solid.flush();
  const stopPolling = mountSidebarRefresh();
  const write = ctx.pending();
  ctx.queueSidebar({ feeds, counts: [{ feedId, count: 2 }] });

  state.markReadAbove();

  const expected = items.slice(0, 26).filter((item) => !item.read);
  expect(ctx.fetchCount()).toBe(before + 1);
  expect(ctx.requestUrl(before)).toBe('/api/feed-items/read');
  expect(ctx.requestBody(before)).toEqual({
    ids: expected.map(({ id }) => id),
  });
  expect(items.slice(0, 5).map(({ id }) => state.articleById(id))).toEqual(
    Array(5).fill(null)
  );
  expect(
    items.slice(5, 26).every(({ id }) => requireArticle(state, id).read)
  ).toBe(true);
  expect(requireArticle(state, items[26].id).read).toBe(false);
  expect(state.feedUnreadCount(feedId)).toBe(7);

  write.resolve(noContentResponse());
  await vi.waitFor(() => expect(state.feedUnreadCount(feedId)).toBe(2));
  expect(ctx.fetchCount()).toBe(before + 5);
  stopPolling();
});

describe('mark read above rollback', () => {
  it('rolls back a failed mark-read-above', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018) })],
      saved: 1,
    });

    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    state.markReadAbove();
    await vi.waitFor(() => expect(ui.currentToast()).not.toBeNull());
    solid.flush();

    expect(state.articleById(state.rowIds()[0])?.read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
