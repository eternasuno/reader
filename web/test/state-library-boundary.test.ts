import { describe, expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';
import { uuid } from './support/state-fixture';

const B1 = '019363b8-0000-7000-8000-000000000001';
const B2 = '019363b8-0000-7000-8000-000000000002';
const B_FEEDS = '019363b8-0000-7000-8000-000000000010';
const B_SAVED = '019363b8-0000-7000-8000-000000000020';

const harness = createAppHarness({ settleTimes: 1 });
harness.installHarnessLifecycle();

const callsMatching = (prefix: string) =>
  harness.fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith(prefix)
  );

const requestBodyOf = (prefix: string, index = 0): unknown => {
  const init = callsMatching(prefix)[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? 'null'));
};

const deferNextFetch = (): ((res: Response) => void) => {
  let resolveFn: (res: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  harness.fetchMock.mockImplementationOnce(() => promise);
  return resolveFn;
};

describe('boundary reset on scope and filter change', () => {
  it('resets listBoundary during scope and unread filter reloads', async () => {
    const { state } = harness.modules;
    harness.respond(() => json({ ids: [], boundary: B1 }));
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    expect(state.listBoundary()).toBe(B1);

    const resolveScope = deferNextFetch();
    const scopeReload = state.loadScopeFirstPage({ kind: 'all' }, false);
    expect(state.listBoundary()).toBeNull();
    resolveScope(json({ groups: [], boundary: B2 }));
    await scopeReload;
    expect(state.listBoundary()).toBe(B2);

    const resolveFilter = deferNextFetch();
    const filterReload = state.loadScopeFirstPage({ kind: 'all' }, true);
    expect(state.listBoundary()).toBeNull();
    resolveFilter(json({ groups: [], boundary: B1 }));
    await filterReload;
    expect(state.listBoundary()).toBe(B1);
  });
});

describe('boundary reset on order change', () => {
  it('resets listBoundary on feed order changes', async () => {
    const { state } = harness.modules;
    await state.loadScopeFirstPage({ kind: 'feed', feedId: uuid(1001) }, false);
    harness.fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );
    const resolveFeed = deferNextFetch();
    const feedReload = state.changeFeedOrder(
      {
        id: uuid(1001),
        url: 'https://example.com/feed.xml',
        title: 'Feed 1',
        folderId: null,
        failureCount: 0,
        readerMode: 'default',
        order: 'newest',
      },
      'oldest'
    );
    await vi.waitFor(() => expect(state.listBoundary()).toBeNull());
    resolveFeed(json({ groups: [], boundary: B1 }));
    await feedReload;
    expect(state.listBoundary()).toBe(B1);
  });
});

describe('sidebar boundary storage and failure preservation', () => {
  it('stores count boundaries, keeps previous pairs when count GETs fail, and clears on reset', async () => {
    const { state, solid } = harness.modules;
    harness.respond((url) => {
      if (url === '/api/feeds/unread-counts') {
        return json({
          items: [{ feedId: uuid(1001), count: 3 }],
          boundary: B_FEEDS,
        });
      }
      if (url === '/api/saved-pages/unread-count') {
        return json({ count: 5, boundary: B_SAVED });
      }
      return undefined;
    });

    await state.refreshSidebar();
    solid.flush();
    expect(state.feedCountsBoundary()).toBe(B_FEEDS);
    expect(state.savedCountBoundary()).toBe(B_SAVED);
    expect(state.scopeCountBoundary({ kind: 'later' })).toBe(B_SAVED);
    expect(state.scopeCountBoundary({ kind: 'all' })).toBe(B_FEEDS);
    expect(state.scopeCountBoundary({ kind: 'feed', feedId: uuid(1001) })).toBe(
      B_FEEDS
    );
    expect(state.scopeCountBoundary({ kind: 'folder', folderId: 'd1' })).toBe(
      B_FEEDS
    );

    harness.respond((url) =>
      url === '/api/feeds/unread-counts' ||
      url === '/api/saved-pages/unread-count'
        ? json({ error: 'FeedRepositoryError' }, 500)
        : undefined
    );
    await state.refreshSidebar();
    solid.flush();
    expect(state.feedUnreadCount(uuid(1001))).toBe(3);
    expect(state.feedCountsBoundary()).toBe(B_FEEDS);
    expect(state.savedUnreadCount()).toBe(5);
    expect(state.savedCountBoundary()).toBe(B_SAVED);

    state.clearSidebarState();
    expect(state.feedCountsBoundary()).toBeNull();
    expect(state.savedCountBoundary()).toBeNull();
  });
});

describe('markScopeAllRead before boundary', () => {
  it('fetches fallback boundary when unknown, uses listBoundary for active scope, and uses scopeCountBoundary for others', async () => {
    const { state } = harness.modules;
    harness.respond((url) => {
      if (url === '/api/feeds/unread-counts') {
        return json({
          items: [{ feedId: uuid(1001), count: 2 }],
          boundary: B_FEEDS,
        });
      }
      if (url === '/api/saved-pages/unread-count') {
        return json({ count: 4, boundary: B_SAVED });
      }
      if (url.startsWith('/api/saved-pages/order?')) {
        return json({ ids: [], boundary: B1 });
      }
      return undefined;
    });

    await state.markScopeAllRead({ kind: 'later' });
    expect(requestBodyOf('/api/saved-pages/read-all', 0)).toEqual({
      before: B_SAVED,
    });

    await state.loadScopeFirstPage({ kind: 'later' }, false);
    await state.refreshSidebar();

    await state.markScopeAllRead({ kind: 'later' });
    expect(requestBodyOf('/api/saved-pages/read-all', 1)).toEqual({
      before: B1,
    });

    await state.markScopeAllRead({ kind: 'feed', feedId: uuid(1001) });
    expect(requestBodyOf(`/api/feeds/${uuid(1001)}/read-all`)).toEqual({
      before: B_FEEDS,
    });
  });
});
