import { beforeEach, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makePage,
  noContentResponse,
  requireArticle,
  savedOrder,
  uuid,
} from './support/state-fixture';

const ctx = createStateTestContext();
let readSync: typeof import('../src/state/read-sync');

beforeEach(async () => {
  await ctx.reset();
  readSync = await import('../src/state/read-sync');
});

const loadPages = async (items: Array<ReturnType<typeof makePage>>) => {
  await ctx.queueLoadedLibrary({
    scope: { kind: 'later' },
    items,
    feeds: [],
    saved: items.filter((item) => !item.read).length,
  });

  return ctx.fetchCount();
};

const waitRequests = (count: number) =>
  vi.waitFor(() => expect(ctx.fetchCount()).toBe(count));

const failure = () => jsonResponse({ error: 'SavedPageRepositoryError' }, 500);

it('sends an uncached ID without changing the unread badge', async () => {
  const { state } = ctx;
  await loadPages([makePage({ id: uuid(1018) })]);
  const before = ctx.fetchCount();
  const write = ctx.pending();
  const id = uuid(1019);

  readSync.requestReadMany([{ id, kind: 'later', feedId: null }]);

  expect(ctx.fetchCount()).toBe(before + 1);
  expect(ctx.requestUrl(before)).toBe(`/api/saved-pages/${id}`);
  expect(ctx.requestBody(before)).toEqual({ read: true });
  expect(state.articleById(id)).toBeNull();
  expect(state.savedUnreadCount()).toBe(1);

  write.resolve(noContentResponse());
  await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
});

it('uses the cached prior state when a target omits it', async () => {
  const { state } = ctx;
  const page = makePage({ id: uuid(1018) });
  await loadPages([page]);
  const write = ctx.pending();

  readSync.requestReadMany([{ id: page.id, kind: 'later', feedId: null }]);

  expect(requireArticle(state, page.id).read).toBe(true);
  expect(state.savedUnreadCount()).toBe(0);
  write.resolve(noContentResponse());
  await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
});

it('toasts on definite failure without patching or changing the badge, and can retry', async () => {
  const { state, ui } = ctx;
  const before = await loadPages([makePage({ id: uuid(1018) })]);
  const id = uuid(1019);
  const target = { id, kind: 'later' as const, feedId: null };
  const write = ctx.pending();

  readSync.requestReadMany([target]);
  write.resolve(failure());
  await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));

  expect(ctx.fetchCount()).toBe(before + 1);
  expect(ui.currentToast()?.variant).toBe('error');
  expect(state.articleById(id)).toBeNull();
  expect(state.savedUnreadCount()).toBe(1);

  ctx.queueEmpty();
  readSync.requestReadMany([target]);
  await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
  expect(ctx.fetchCount()).toBe(before + 2);
  expect(ctx.requestBody(before + 1)).toEqual({ read: true });
});

it('keeps the intent when content arrives mid-write and refreshes it on definite failure', async () => {
  const { state, solid } = ctx;
  const page = makePage({ id: uuid(1018) });
  ctx.queueSidebar({ saved: 1 });
  await state.refreshSidebar();
  ctx.queue(savedOrder([page]));
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  const content = ctx.pending();
  state.requestWindow({ start: 0, end: 0 });
  state.setVisibleRange({ first: 0, last: 0 });
  solid.flush();
  const write = ctx.pending();
  const recovery = ctx.pending();

  state.markReadAbove();
  content.resolve(jsonResponse({ items: [page] }));
  await vi.waitFor(() =>
    expect(requireArticle(state, page.id).read).toBe(true)
  );
  expect(state.savedUnreadCount()).toBe(1);

  write.resolve(failure());
  await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
  recovery.resolve(jsonResponse({ items: [page] }));
  await vi.waitFor(() =>
    expect(requireArticle(state, page.id).read).toBe(false)
  );
  expect(state.savedUnreadCount()).toBe(1);
});

it('coalesces later toggles for an uncached ID without changing the badge', async () => {
  const { state } = ctx;
  const before = await loadPages([makePage({ id: uuid(1018) })]);
  const id = uuid(1019);
  const first = ctx.pending();
  const second = ctx.pending();

  readSync.requestReadMany([{ id, kind: 'later', feedId: null }]);
  const toggles = [false, true, false].map((read) =>
    state.toggleArticleRead(id, read)
  );
  expect(ctx.fetchCount()).toBe(before + 1);
  expect(state.savedUnreadCount()).toBe(1);

  first.resolve(failure());
  await waitRequests(before + 2);
  expect(ctx.requestUrl(before + 1)).toBe(`/api/saved-pages/${id}`);
  expect(ctx.requestBody(before + 1)).toEqual({ read: false });

  second.resolve(noContentResponse());
  await expect(Promise.all(toggles)).resolves.toEqual([true, false, true]);
  expect(ctx.ui.currentToast()).toBeNull();
  expect(state.savedUnreadCount()).toBe(1);
  expect(ctx.fetchCount()).toBe(before + 2);
});

it('keeps at most two of five chunks in flight and orders mark-all after them', async () => {
  const { state } = ctx;
  const ids = Array.from({ length: 1000 }, (_, index) => uuid(index + 1));
  ctx.queue({ ids, boundary: uuid(1001) });
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  const before = ctx.fetchCount();
  const chunks = Array.from({ length: 5 }, () => ctx.pending());
  const barrier = ctx.pending();
  const toggle = ctx.pending();
  ctx.queueSidebar({ saved: 1 });

  readSync.requestReadMany(
    ids.map((id) => ({ id, kind: 'later', feedId: null }))
  );
  const marking = state.markScopeAllRead({ kind: 'later' });
  const toggled = state.toggleArticleRead(ids[0], false);
  expect(ctx.fetchCount()).toBe(before + 2);

  for (const [offset, chunk] of chunks.slice(0, 3).entries()) {
    chunk.resolve(noContentResponse());
    await waitRequests(before + 3 + offset);
  }

  chunks[3].resolve(noContentResponse());
  // The last chunk remains pending, so neither the barrier nor the toggle can start.
  expect(readSync.queueIdle()).toBe(false);
  expect(ctx.fetchCount()).toBe(before + 5);
  for (let offset = 0; offset < chunks.length; offset += 1) {
    expect(ctx.requestUrl(before + offset)).toBe('/api/saved-pages/read');
    expect(ctx.requestBody(before + offset)).toEqual({
      ids: ids.slice(offset * 200, (offset + 1) * 200),
    });
  }

  chunks[4].resolve(noContentResponse());
  await waitRequests(before + 6);
  expect(ctx.requestUrl(before + 5)).toBe('/api/saved-pages/read-all');
  expect(ctx.requestBody(before + 5)).toEqual({ before: uuid(1001) });

  barrier.resolve(noContentResponse());
  await vi.waitFor(() =>
    expect(ctx.requestUrl(before + 6)).toBe(`/api/saved-pages/${ids[0]}`)
  );
  expect(ctx.requestBody(before + 6)).toEqual({ read: false });
  toggle.resolve(noContentResponse());
  await expect(toggled).resolves.toBe(true);
  await marking;
});

it('recovers a single ambiguous toggle and refreshes sidebar counts once after drain', async () => {
  const { state, solid, ui } = ctx;
  const { mountSidebarRefresh } = await import('../src/state/sidebar-refresh');
  const stopPolling = mountSidebarRefresh();
  const page = makePage({ id: uuid(1018) });
  const before = await loadPages([page]);
  ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const window = ctx.pending();
  ctx.queueSidebar({ saved: 1 });

  await expect(state.toggleArticleRead(page.id, true)).resolves.toBe(false);
  solid.flush();
  expect(ui.currentToast()?.variant).toBe('error');
  await waitRequests(before + 6);
  expect(ctx.requestUrl(before + 1)).toMatch(/^\/api\/saved-pages\?ids=/);

  window.resolve(jsonResponse({ items: [{ ...page, read: true }] }));
  await vi.waitFor(() =>
    expect(requireArticle(state, page.id).read).toBe(true)
  );
  expect(state.savedUnreadCount()).toBe(1);
  stopPolling();
});

it('refreshes the window and sidebar counts once after a batch fails ambiguously', async () => {
  const { state, solid, ui } = ctx;
  const { mountSidebarRefresh } = await import('../src/state/sidebar-refresh');
  const stopPolling = mountSidebarRefresh();
  const items = [makePage({ id: uuid(1018) }), makePage({ id: uuid(1019) })];
  const before = await loadPages(items);
  ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const window = ctx.pending();
  ctx.queueSidebar({ saved: 1 });

  state.markReadAbove();
  solid.flush();
  expect(items.map(({ id }) => requireArticle(state, id).read)).toEqual([
    true,
    true,
  ]);
  await waitRequests(before + 6);
  expect(ui.currentToast()?.variant).toBe('error');
  expect(ctx.requestUrl(before)).toBe('/api/saved-pages/read');
  expect(ctx.requestUrl(before + 1)).toMatch(/^\/api\/saved-pages\?ids=/);

  window.resolve(
    jsonResponse({ items: [{ ...items[0], read: true }, items[1]] })
  );
  await vi.waitFor(() => {
    expect(items.map(({ id }) => requireArticle(state, id).read)).toEqual([
      true,
      false,
    ]);
    expect(state.savedUnreadCount()).toBe(1);
  });
  expect(ctx.fetchCount()).toBe(before + 6);
  stopPolling();
});

it('retires an idle unknown entry when the recovery window omits its record', async () => {
  const { state } = ctx;
  const page = makePage({ id: uuid(1018) });
  const before = await loadPages([page]);
  const { entries } = await import('../src/state/read-sync-state');
  ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const recovery = ctx.pending();

  await expect(state.toggleArticleRead(page.id, true)).resolves.toBe(false);
  await waitRequests(before + 2);
  expect(ctx.requestUrl(before + 1)).toBe(`/api/saved-pages?ids=${page.id}`);
  expect(entries.get(page.id)).toHaveProperty('confirmed', undefined);

  recovery.resolve(jsonResponse({ items: [] }));
  await vi.waitFor(() => expect(state.articleById(page.id)).toBeNull());
  expect(state.rowIds()).toEqual([]);
  expect(entries.has(page.id)).toBe(false);
});

it('shows an empty reader and releases its retained record when detail recovery returns missing', async () => {
  const { state } = ctx;
  const page = makePage({ id: uuid(1018), read: true });
  ctx.queue({ item: page });
  await state.openArticleByRoute({ kind: 'later' }, page.id);
  expect(state.openArticle()?.id).toBe(page.id);
  expect(state.rowIds()).toEqual([]);
  const before = ctx.fetchCount();
  ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const recovery = ctx.pending();

  await expect(state.toggleArticleRead(page.id, false)).resolves.toBe(false);
  await waitRequests(before + 2);
  expect(ctx.requestUrl(before + 1)).toBe(`/api/saved-pages/${page.id}`);
  expect(ctx.requestInit(before + 1).method).toBe('GET');
  recovery.resolve(jsonResponse({ item: null }));

  await vi.waitFor(() => expect(state.openArticle()).toBeNull());
  expect(state.openArticleId()).toBe(page.id);
  expect(state.articleById(page.id)).toBeNull();
});

it.each([true, false])(
  'recovers an open article with window membership %s',
  async (inWindow) => {
    const { state } = ctx;
    const page = makePage({ id: uuid(1018), read: true });
    if (inWindow) await loadPages([page]);
    else ctx.queue({ item: page });

    await state.openArticleByRoute({ kind: 'later' }, page.id);
    expect(state.openArticle()?.id).toBe(page.id);
    const before = ctx.fetchCount();
    ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const updated = { ...page, read: false };
    ctx.queue(inWindow ? { items: [updated] } : { item: updated });

    await expect(state.toggleArticleRead(page.id, false)).resolves.toBe(false);
    await vi.waitFor(() => {
      expect(state.openArticle()?.id).toBe(page.id);
      expect(state.openArticle()?.read).toBe(false);
    });
    expect(ctx.fetchCount()).toBe(before + 2);
    if (inWindow)
      expect(ctx.requestUrl(before + 1)).toMatch(/^\/api\/saved-pages\?ids=/);
    else expect(ctx.requestUrl(before + 1)).toBe(`/api/saved-pages/${page.id}`);
  }
);
