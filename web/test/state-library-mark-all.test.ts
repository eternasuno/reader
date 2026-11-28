import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerLibraryRead,
  routeDeferredWrites,
} from './support/mark-all-routes';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse,
  loadWindowedScope,
  makeFeed,
  makeItem,
  makePage,
  mountTestWindow,
  noContentResponse,
  savedOrder,
  uuid,
  waitForWindow,
} from './support/state-fixture';

const B1 = '019363b8-0000-7000-8000-000000000001';
const B2 = '019363b8-0000-7000-8000-000000000002';
const B_COUNT = '019363b8-0000-7000-8000-000000000099';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

/** Loads `/later` with an explicit boundary so ids at or below `boundary` are covered by mark-all. */
const loadLater = async (
  items: Array<ReturnType<typeof makePage>>,
  boundary = B2
): Promise<void> => {
  ctx.queue(savedOrder(items, boundary));
  if (items.length > 0) ctx.queue({ items });
  await loadWindowedScope(ctx.state, { kind: 'later' }, false);
  ctx.solid.flush();
};

/** Answers `/api/feed-items` list reloads with one feed item read, other GETs with defaults. */
const routeAllListReload = (): void => {
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve(noContentResponse());
    }
    const items = [
      makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    ];
    if (url.startsWith('/api/feed-items/order?'))
      return Promise.resolve(jsonResponse(feedOrder(items, B2)));
    if (url.startsWith('/api/feed-items?ids='))
      return Promise.resolve(jsonResponse({ items }));
    return answerLibraryRead(url);
  });
};

describe('mark-all barrier ordering', () => {
  it('waits for earlier toggles and holds later toggles until mark-all finishes', async () => {
    const { state, solid } = ctx;
    await loadLater([makePage({ id: B1 }), makePage({ id: B2 })]);
    const routed = routeDeferredWrites(ctx.fetchMock);

    const pPrior = state.toggleArticleRead(B1, true);
    const marking = state.markScopeAllRead({ kind: 'later' });
    const pLater = state.toggleArticleRead(B2, false);
    solid.flush();

    expect(routed.order).toEqual([`PATCH /api/saved-pages/${B1}`]);

    routed.resolveNext(`/api/saved-pages/${B1}`);
    await vi.waitFor(() =>
      expect(routed.count('/api/saved-pages/read-all')).toBe(1)
    );

    routed.resolveNext('/api/saved-pages/read-all');
    await vi.waitFor(() =>
      expect(routed.count(`/api/saved-pages/${B2}`)).toBe(1)
    );

    routed.resolveNext(`/api/saved-pages/${B2}`);
    await Promise.all([pPrior, marking, pLater]);
    expect(routed.order).toEqual([
      `PATCH /api/saved-pages/${B1}`,
      'POST /api/saved-pages/read-all',
      `PATCH /api/saved-pages/${B2}`,
    ]);
    expect(state.rowIds().map((id) => state.articleById(id)?.read)).toEqual([
      true,
      false,
    ]);
  });
});

describe('mark-all repeat clicks', () => {
  it('enqueues repeat clicks serially and clears pending only after all settle', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018) })],
    });
    const routed = routeDeferredWrites(ctx.fetchMock);

    const first = state.markScopeAllRead({ kind: 'later' });
    const second = state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(state.isMarkingScope({ kind: 'later' })).toBe(true);
    await vi.waitFor(() =>
      expect(routed.count('/api/saved-pages/read-all')).toBe(1)
    );

    routed.resolveNext('/api/saved-pages/read-all');
    await first;
    expect(state.isMarkingScope({ kind: 'later' })).toBe(true);
    await vi.waitFor(() =>
      expect(routed.count('/api/saved-pages/read-all')).toBe(1)
    );

    routed.resolveNext('/api/saved-pages/read-all');
    await second;
    expect(state.isMarkingScope({ kind: 'later' })).toBe(false);
  });
});

describe('mark-all boundary fallback and errors', () => {
  it('fetches the count endpoint for boundary on first click without publishing to sidebar', async () => {
    const { state, solid } = ctx;
    ctx.queue({
      items: [{ feedId: uuid(1001), count: 3 }],
      boundary: B_COUNT,
    });
    const writeSlot = ctx.pending();
    ctx.queueSidebar({ feeds: [makeFeed({ id: uuid(1001) })], counts: [] });

    const before = ctx.fetchCount();
    const marking = state.markScopeAllRead({ kind: 'all' });
    solid.flush();
    // The write stays in flight, so this snapshot is taken after the boundary fetch resolved and
    // before the post-success sidebar refresh that would publish counts.
    await vi.waitFor(() =>
      expect(ctx.fetchCount()).toBeGreaterThanOrEqual(before + 2)
    );

    expect(ctx.requestUrl(before)).toBe('/api/feeds/unread-counts');
    expect(state.feedCountsBoundary()).toBeNull();
    expect(state.feedUnreadCount(uuid(1001))).toBe(0);
    expect(ctx.requestUrl(before + 1)).toBe('/api/feed-items/read-all');
    expect(ctx.requestBody(before + 1)).toEqual({ before: B_COUNT });

    writeSlot.resolve(noContentResponse());
    await marking;
  });
});

describe('mark-all fallback count fetch error', () => {
  it('toasts and skips write and reload when the fallback count fetch fails', async () => {
    const { state, solid, ui, i18n } = ctx;
    const before = ctx.fetchCount();
    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);

    await state.markScopeAllRead({ kind: 'later' });
    solid.flush();

    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/unread-count');
    expect(state.isMarkingScope({ kind: 'later' })).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SavedPageRepositoryError')
    );
  });
});

describe('mark-all of a scope other than the open list', () => {
  it('reloads the open /all list from page one when a sidebar mark-all marks one feed', async () => {
    const { state, solid } = ctx;
    const release = state.trackLibraryMount();
    const unmountWindow = mountTestWindow(state);
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [makeFeed({ id: uuid(1001) }), makeFeed({ id: uuid(1002) })],
      counts: [
        { feedId: uuid(1001), count: 1 },
        { feedId: uuid(1002), count: 1 },
      ],
    });
    routeAllListReload();

    const before = ctx.fetchCount();
    await state.markScopeAllRead({ kind: 'feed', feedId: uuid(1001) });
    solid.flush();

    await waitForWindow(state);
    expect(ctx.requestUrl(before)).toBe(`/api/feeds/${uuid(1001)}/read-all`);
    expect(ctx.requestBody(before)).toEqual({
      before: '019363b8-0000-7000-8000-000000000000',
    });
    expect(ctx.fetchCount()).toBe(before + 3);
    expect(ctx.requestUrl(before + 1)).toContain('/api/feed-items/order?');
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
    unmountWindow();
    release();
  });
});

describe('mark-all ambiguous failure', () => {
  it('reloads and refreshes without a toast on ambiguous network failure', async () => {
    const { state, solid, ui } = ctx;
    const release = state.trackLibraryMount();
    const unmountWindow = mountTestWindow(state);
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
      feeds: [makeFeed({ id: uuid(1001) })],
      counts: [{ feedId: uuid(1001), count: 1 }],
    });

    const before = ctx.fetchCount();
    ctx.fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const items = [
      makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    ];
    ctx.queue(feedOrder(items, B1));
    ctx.queue({ items });

    await state.markScopeAllRead({ kind: 'all' });
    solid.flush();

    await waitForWindow(state);
    expect(ctx.requestUrl(before)).toBe('/api/feed-items/read-all');
    expect(ctx.requestUrl(before + 1)).toContain('/api/feed-items/order?');
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
    expect(ui.currentToast()).toBeNull();
    unmountWindow();
    release();
  });
});

describe('mark-all session clear', () => {
  it('does nothing and shows no toast if session clears while pending', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018) })],
    });
    const pendingReq = ctx.pending();
    const before = ctx.fetchCount();
    const marking = state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(state.isMarkingScope({ kind: 'later' })).toBe(true);

    state.markUnauthenticated();
    solid.flush();
    expect(state.isMarkingScope({ kind: 'later' })).toBe(false);

    pendingReq.resolve(
      jsonResponse({ error: 'SavedPageRepositoryError' }, 500)
    );
    await marking;
    solid.flush();

    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ui.currentToast()).toBeNull();
  });
});
