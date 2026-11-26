import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed, FeedItem, FeedUnreadCount, SavedPage } from '../src/api';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
  noContentResponse,
} from './support/state-fixture';

const B1 = '019363b8-0000-7000-8000-000000000001';
const B2 = '019363b8-0000-7000-8000-000000000002';
const B3 = '019363b8-0000-7000-8000-000000000003';

const ctx = createStateTestContext();

interface ReadRoutes {
  feeds?: Array<Feed>;
  counts?: Array<FeedUnreadCount>;
  saved: number;
  page: Array<SavedPage | FeedItem>;
}

/** Answers every GET by URL so sidebar refresh and reloads do not depend on request order. */
const routeReads = (routes: ReadRoutes): void => {
  const bodies: Record<string, () => unknown> = {
    '/api/feeds': () => ({ items: routes.feeds ?? [] }),
    '/api/folders': () => ({ items: [] }),
    '/api/feeds/unread-counts': () => ({
      items: routes.counts ?? [],
      boundary: B2,
    }),
    '/api/saved-pages/unread-count': () => ({
      count: routes.saved,
      boundary: B2,
    }),
  };
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve(noContentResponse());
    }
    const url = String(input);
    const body = bodies[url];
    return Promise.resolve(
      jsonResponse(
        body ? body() : { items: routes.page, cursor: null, boundary: B2 }
      )
    );
  });
};

beforeEach(async () => {
  await ctx.reset();
});

describe('scope mark-all', () => {
  it('is pessimistic and reloads the active feed scope after confirmation', async () => {
    const { state, solid } = ctx;
    const sidebarRefresh = await import('../src/state/sidebar-refresh');
    const releaseLibrary = state.trackLibraryMount();
    const stopPolling = sidebarRefresh.mountSidebarRefresh();
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })],
      counts: [
        { feedId: 'f1', count: 1 },
        { feedId: 'f2', count: 1 },
      ],
    });

    const markReq = ctx.pending();
    const before = ctx.fetchCount();
    const marking = state.markScopeAllRead({ kind: 'feed', feedId: 'f1' });
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/feeds/f1/read-all');
    expect(state.rows().find((row) => row.id === 'i1')?.read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(1);
    expect(state.feedUnreadCount('f2')).toBe(1);
    expect(state.isMarkingScope({ kind: 'feed', feedId: 'f1' })).toBe(true);

    routeReads({
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })],
      counts: [
        { feedId: 'f1', count: 0 },
        { feedId: 'f2', count: 1 },
      ],
      saved: 0,
      page: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
    });
    markReq.resolve(noContentResponse());
    await marking;
    await vi.waitFor(() => expect(state.feedUnreadCount('f1')).toBe(0));
    solid.flush();

    expect(state.rows().find((row) => row.id === 'i1')?.read).toBe(true);
    expect(state.feedUnreadCount('f2')).toBe(1);
    expect(state.isMarkingScope({ kind: 'feed', feedId: 'f1' })).toBe(false);
    stopPolling();
    releaseLibrary();
  });
});

describe('saved mark-all', () => {
  it('reloads saved pages and refreshes count only after server confirmation', async () => {
    const { state, solid } = ctx;
    const sidebarRefresh = await import('../src/state/sidebar-refresh');
    const releaseLibrary = state.trackLibraryMount();
    const stopPolling = sidebarRefresh.mountSidebarRefresh();
    ctx.queue({ items: [makePage({ id: 'p1' })], cursor: null, boundary: B1 });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    ctx.queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    const markReq = ctx.pending();
    const before = ctx.fetchCount();
    const marking = state.markScopeAllRead();
    solid.flush();

    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/read-all');
    expect(ctx.requestBody(before)).toEqual({ before: B1 });
    expect(state.savedUnreadCount()).toBe(1);
    expect(state.rows()[0].read).toBe(false);

    routeReads({
      saved: 0,
      page: [makePage({ id: 'p1', read: true })],
    });
    markReq.resolve(noContentResponse());
    await marking;
    await vi.waitFor(() => expect(state.savedUnreadCount()).toBe(0));
    solid.flush();
    stopPolling();
    releaseLibrary();

    expect(state.savedUnreadCount()).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('mark-all failure', () => {
  it('toasts and leaves rows, counts, and list unchanged on server failure', async () => {
    const { state, solid, ui, i18n } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });

    const before = ctx.fetchCount();
    ctx.queue({ error: 'FeedItemRepositoryError' }, 500);
    await state.markScopeAllRead({ kind: 'all' });
    solid.flush();

    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()[0].read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(1);
    expect(state.isMarkingScope({ kind: 'all' })).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('FeedItemRepositoryError')
    );
  });
});

describe('stale scope rollback guard', () => {
  it('does not roll back read state after a newer scope has loaded', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
    });

    const failure = ctx.pending();
    state.markLoadedRead();
    solid.flush();

    ctx.queue({
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      cursor: null,
      boundary: B1,
    });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    ctx.queueSidebar({ saved: 1 });
    failure.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await vi.waitFor(() => expect(ui.currentToast()).not.toBeNull());
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
    expect(state.rows()[0].read).toBe(false);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('bulk vs newer toggle: failure', () => {
  it('does not let a failed bulk request overwrite a newer toggle on a row', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      feeds: [],
      saved: 2,
    });
    const before = ctx.fetchCount();
    const bulkReq = ctx.pending();

    state.markLoadedRead();
    solid.flush();
    const toggling = state.toggleArticleRead('p1', false);
    solid.flush();
    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(false);

    bulkReq.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
    await expect(toggling).resolves.toBe(true);
    solid.flush();

    expect(state.rows().map((row) => row.read)).toEqual([false, false]);
    expect(state.savedUnreadCount()).toBe(2);
    expect(ctx.fetchCount()).toBe(before + 1);
  });
});

const routeBulkToggle = () => {
  let resolveBulk!: () => void;
  let resolveToggle!: () => void;
  const sent: Array<string> = [];
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    sent.push(`${method} ${url}`);
    if (url === '/api/saved-pages/read-all') {
      return new Promise<Response>((res) => {
        resolveBulk = () => res(noContentResponse());
      });
    }
    if (url === `/api/saved-pages/${B1}` && method === 'PATCH') {
      return new Promise<Response>((res) => {
        resolveToggle = () => res(noContentResponse());
      });
    }
    if (url.startsWith('/api/saved-pages?')) {
      return Promise.resolve(
        jsonResponse({
          items: [
            makePage({ id: B1, read: true }),
            makePage({ id: B3, read: true }),
          ],
          cursor: null,
          boundary: B2,
        })
      );
    }
    if (url === '/api/saved-pages/unread-count')
      return Promise.resolve(jsonResponse({ count: 1, boundary: B2 }));
    return Promise.resolve(jsonResponse({ items: [], boundary: B2 }));
  });
  return {
    sent,
    resolveBulk: () => resolveBulk(),
    resolveToggle: () => resolveToggle(),
  };
};

describe('bulk vs newer toggle: success', () => {
  it('sends a toggle made during markScopeAllRead after the barrier succeeds', async () => {
    const { state, solid } = ctx;
    state.trackLibraryMount();
    ctx.queueSidebar({ saved: 2 });
    await state.refreshSidebar();
    ctx.queue({
      items: [makePage({ id: B1 }), makePage({ id: B3 })],
      cursor: null,
      boundary: B2,
    });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    const routed = routeBulkToggle();

    const marking = state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(state.savedUnreadCount()).toBe(2);
    expect(state.rows().map((row) => row.read)).toEqual([false, false]);

    const markUnread = state.toggleArticleRead(B1, false);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(2);

    routed.resolveBulk();
    await vi.waitFor(() =>
      expect(routed.sent).toContain(`PATCH /api/saved-pages/${B1}`)
    );
    await marking;

    routed.resolveToggle();
    await expect(markUnread).resolves.toBe(true);
    solid.flush();

    expect(state.rows().map((row) => row.read)).toEqual([false, true]);
  });
});
