import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerLibraryRead,
  routeDeferredWrites,
} from './support/mark-all-routes';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeFolder,
  makeItem,
  makePage,
  noContentResponse,
  savedOrder,
  uuid,
} from './support/state-fixture';

const B2 = '019363b8-0000-7000-8000-000000000002';
const B1 = '019363b8-0000-7000-8000-000000000001';
const B3 = '019363b8-0000-7000-8000-000000000003';

const laterB1 = {
  ...makePage({ id: B1, read: false }),
  kind: 'later' as const,
};

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
  await ctx.state.loadScopeFirstPage({ kind: 'later' }, false);
  ctx.solid.flush();
};

const methodUrls = (method: string): Array<string> =>
  ctx.fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([url]) => String(url));

/** Count GETs issued since call index `since`. */
const countCalls = (since: number): Array<unknown> =>
  ctx.fetchMock.mock.calls
    .slice(since)
    .filter(([url]) => String(url) === '/api/feeds/unread-counts');

const routeGetsOnly = (): void => {
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
    (init?.method ?? 'GET') === 'GET'
      ? answerLibraryRead(String(input))
      : Promise.resolve(noContentResponse())
  );
};

describe('mark-all session guard', () => {
  it('sends no read-all when the session ends during the first-click count GET and a new session starts', async () => {
    const { state, solid, ui } = ctx;
    const countReq = ctx.pending();

    const before = ctx.fetchCount();
    const marking = state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(ctx.requestUrl(before)).toBe('/api/saved-pages/unread-count');

    state.markUnauthenticated();
    state.markAuthenticated();
    countReq.resolve(jsonResponse({ count: 1, boundary: B2 }));
    await marking;
    await new Promise((resolve) => setTimeout(resolve, 0));
    solid.flush();

    expect(ctx.fetchCount()).toBe(before + 1);
    expect(methodUrls('POST')).toEqual([]);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('mark-all boundary cutoff', () => {
  it('sends a later toggle above the boundary but not one at or below it', async () => {
    const { state, solid } = ctx;
    await loadLater([makePage({ id: B1 }), makePage({ id: B3 })]);
    const routed = routeDeferredWrites(ctx.fetchMock);

    const marking = state.markScopeAllRead({ kind: 'later' });
    const covered = state.toggleArticleRead(B1, true);
    const above = state.toggleArticleRead(B3, true);
    solid.flush();
    await vi.waitFor(() =>
      expect(routed.count('/api/saved-pages/read-all')).toBe(1)
    );

    routed.resolveNext('/api/saved-pages/read-all');
    await vi.waitFor(() =>
      expect(routed.count(`/api/saved-pages/${B3}`)).toBe(1)
    );
    routed.resolveNext(`/api/saved-pages/${B3}`);

    await expect(Promise.all([covered, above])).resolves.toEqual([true, true]);
    await marking;
    expect(routed.order).toEqual([
      'POST /api/saved-pages/read-all',
      `PATCH /api/saved-pages/${B3}`,
    ]);
  });
});

describe('mark-all ambiguous settlement', () => {
  it('sends an explicit later intent after an ambiguous barrier instead of trusting an unknown value', async () => {
    const { state, solid, ui } = ctx;
    await loadLater([makePage({ id: B1, read: false })]);
    const routed = routeDeferredWrites(ctx.fetchMock);

    const marking = state.markScopeAllRead({ kind: 'later' });
    const toggle = state.toggleArticleRead(B1, true);
    solid.flush();
    await vi.waitFor(() =>
      expect(routed.count('/api/saved-pages/read-all')).toBe(1)
    );

    routed.rejectNext('/api/saved-pages/read-all');
    await vi.waitFor(() =>
      expect(routed.count(`/api/saved-pages/${B1}`)).toBe(1)
    );
    routed.resolveNext(`/api/saved-pages/${B1}`);

    await expect(toggle).resolves.toBe(true);
    await marking;
    expect(routed.order).toEqual([
      'POST /api/saved-pages/read-all',
      `PATCH /api/saved-pages/${B1}`,
    ]);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('mark-all snapshot stamps', () => {
  it('keeps a pre-barrier snapshot from restoring unread only while it is in flight', async () => {
    const { state } = ctx;
    const readSync = await import('../src/state/read-sync');
    await loadLater([makePage({ id: B1, read: false })]);
    routeGetsOnly();

    const older = readSync.beginRecordSnapshot();
    await state.markScopeAllRead({ kind: 'later' });
    expect(readSync.mergeSnapshotRead(laterB1, older.seq)).toBe(true);
    older.release();

    const newer = readSync.beginRecordSnapshot();
    expect(readSync.mergeSnapshotRead(laterB1, newer.seq)).toBe(false);
    newer.release();
  });

  it('does not infer read from an ambiguous mark-all for a pre-barrier snapshot', async () => {
    const { state } = ctx;
    const readSync = await import('../src/state/read-sync');
    await loadLater([makePage({ id: B1, read: false })]);
    ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? answerLibraryRead(String(input))
        : Promise.reject(new TypeError('network down'))
    );

    const older = readSync.beginRecordSnapshot();
    await state.markScopeAllRead({ kind: 'later' });
    expect(readSync.mergeSnapshotRead(laterB1, older.seq)).toBe(false);
    older.release();
  });
});

describe('mark-all folder membership', () => {
  it('keeps a pre-barrier snapshot unread for a feed moved into the folder after mark-all was sent', async () => {
    const { state, solid } = ctx;
    const readSync = await import('../src/state/read-sync');
    const release = state.trackLibraryMount();
    ctx.queueSidebar({
      feeds: [
        makeFeed({ id: uuid(1001), folderId: 'A' }),
        makeFeed({ id: uuid(1002) }),
      ],
      folders: [makeFolder('A')],
    });
    await state.refreshSidebar();
    ctx.queue({ groups: [], boundary: B2 });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'A' }, false);
    solid.flush();
    ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') !== 'GET')
        return Promise.resolve(noContentResponse());
      if (url.startsWith('/api/folders/A/items'))
        return Promise.resolve(jsonResponse({ groups: [], boundary: B2 }));
      return answerLibraryRead(url);
    });

    const staleSnapshot = readSync.beginRecordSnapshot();
    await state.markScopeAllRead({ kind: 'folder', folderId: 'A' });
    await state.moveFeedToFolder(makeFeed({ id: uuid(1002) }), 'A');
    const f2Item = {
      ...makeItem({ id: B1, feedId: uuid(1002) }),
      kind: 'feed' as const,
    };
    expect(readSync.mergeSnapshotRead(f2Item, staleSnapshot.seq)).toBe(false);
    staleSnapshot.release();
    release();
  });
});

describe('mark-all covered entries', () => {
  it('shows covered rows read after an ok barrier while an older snapshot still holds their entry', async () => {
    const { state, solid } = ctx;
    const readSync = await import('../src/state/read-sync');
    await loadLater([makePage({ id: B1, read: true })]);
    routeGetsOnly();

    const olderSnapshot = readSync.beginRecordSnapshot();
    await state.toggleArticleRead(B1, false);
    solid.flush();
    expect(state.rows()[0].read).toBe(false);

    await state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    olderSnapshot.release();
  });
});

/** Routes writes to 204 and reads to the post-mark-all server state where `B1` is read. */
const routeReadAfterMarkAll = (
  listItems: Array<ReturnType<typeof makePage>>
): void => {
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve(noContentResponse());
    }
    if (url === `/api/saved-pages/${B1}`) {
      return Promise.resolve(
        jsonResponse({ item: makePage({ id: B1, read: true }) })
      );
    }
    if (url.startsWith('/api/saved-pages/order?'))
      return Promise.resolve(jsonResponse(savedOrder(listItems, B2)));
    if (url.startsWith('/api/saved-pages?ids='))
      return Promise.resolve(jsonResponse({ items: listItems }));
    return answerLibraryRead(url);
  });
};

describe('mark-all detail refresh settlement', () => {
  it('keeps read:true when a detail GET dispatched before mark-all settles resolves afterwards', async () => {
    const { state, solid } = ctx;
    const release = state.trackLibraryMount();
    await loadLater([makePage({ id: B1, read: false })]);
    routeReadAfterMarkAll([makePage({ id: B1, read: true })]);
    const staleDetail = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, B1);

    await state.markScopeAllRead({ kind: 'later' });
    solid.flush();
    expect(state.rows()[0]?.read).toBe(true);

    staleDetail.resolve(
      jsonResponse({ item: makePage({ id: B1, read: false }) })
    );
    await opening;
    solid.flush();

    expect(state.rows()[0]?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
    expect(methodUrls('PATCH')).toEqual([]);
    release();
  });

  it('keeps read:true for a deep-linked article outside the store when its pre-barrier detail GET resolves late', async () => {
    const { state, solid } = ctx;
    const release = state.trackLibraryMount();
    await loadLater([]);
    routeGetsOnly();
    const staleDetail = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, B1);

    await state.markScopeAllRead({ kind: 'later' });
    staleDetail.resolve(
      jsonResponse({ item: makePage({ id: B1, read: false }) })
    );
    await opening;
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);
    expect(methodUrls('PATCH')).toEqual([]);
    release();
  });
});

describe('mark-all count refresh after the queue drains', () => {
  it('refreshes sidebar counts exactly once after the drain while the library is mounted', async () => {
    const { state } = ctx;
    const sidebarRefresh = await import('../src/state/sidebar-refresh');
    const releaseLibrary = state.trackLibraryMount();
    const stopPolling = sidebarRefresh.mountSidebarRefresh();
    await loadLater([makePage({ id: B1 })]);
    routeGetsOnly();

    const before = ctx.fetchCount();
    await state.markScopeAllRead({ kind: 'later' });
    await vi.waitFor(() => expect(countCalls(before)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countCalls(before)).toHaveLength(1);
    stopPolling();
    releaseLibrary();
  });

  it('refreshes sidebar counts once directly when no library page is mounted', async () => {
    const { state } = ctx;
    await loadLater([makePage({ id: B1 })]);
    routeGetsOnly();

    const before = ctx.fetchCount();
    await state.markScopeAllRead({ kind: 'later' });

    expect(countCalls(before)).toHaveLength(1);
  });
});
