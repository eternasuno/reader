import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness, json as harnessJson } from './support/app-harness';
import {
  createStateTestContext,
  jsonResponse,
  uuid,
} from './support/state-fixture';

type ReadSyncMod = typeof import('../src/state/read-sync');
type SidebarRefreshMod = typeof import('../src/state/sidebar-refresh');

const ctx = createStateTestContext();
let readSync: ReadSyncMod;
let sidebarRefresh: SidebarRefreshMod;
let stopPolling: () => void = () => {};

const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
};

const feedCalls = (): number =>
  ctx.fetchMock.mock.calls.filter(([url]) => url === '/api/feeds').length;

const queueDefaultSidebar = (saved = 1): void => {
  ctx.queueSidebar({ saved });
};

const setupPollingTest = async (): Promise<void> => {
  vi.useFakeTimers();
  setHidden(false);
  await ctx.reset();
  readSync = await import('../src/state/read-sync');
  sidebarRefresh = await import('../src/state/sidebar-refresh');
};

const teardownPollingTest = (): void => {
  stopPolling();
  stopPolling = () => {};
  setHidden(false);
  vi.useRealTimers();
};

describe('sidebar periodic 60 s polling', () => {
  beforeEach(setupPollingTest);
  afterEach(teardownPollingTest);

  it('polls every 60 s and skips ticks while the read queue is busy', async () => {
    stopPolling = sidebarRefresh.mountSidebarRefresh();
    const onTick = vi.fn();
    sidebarRefresh.onLibraryTick(onTick);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(feedCalls()).toBe(0);

    queueDefaultSidebar(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(feedCalls()).toBe(1);
    expect(ctx.state.savedUnreadCount()).toBe(2);
    expect(onTick.mock.calls).toEqual([['periodic']]);

    let releaseBarrier!: (outcome: 'ok') => void;
    const barrier = readSync.enqueueBarrier({
      affects: () => true,
      execute: () =>
        new Promise((res) => {
          releaseBarrier = res;
        }),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(feedCalls()).toBe(1);

    queueDefaultSidebar(1);
    releaseBarrier('ok');
    await barrier;
    await vi.waitFor(() => expect(feedCalls()).toBe(2));
    expect(onTick.mock.calls).toEqual([['periodic']]);
  });
});

describe('sidebar visibility polling pause and resume', () => {
  beforeEach(setupPollingTest);
  afterEach(teardownPollingTest);

  it('pauses timer while hidden and refreshes immediately when visible', async () => {
    stopPolling = sidebarRefresh.mountSidebarRefresh();
    const onTick = vi.fn();
    sidebarRefresh.onLibraryTick(onTick);

    await vi.advanceTimersByTimeAsync(30_000);
    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.advanceTimersByTimeAsync(180_000);
    expect(feedCalls()).toBe(0);

    queueDefaultSidebar(3);
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.state.savedUnreadCount()).toBe(3);
    expect(feedCalls()).toBe(1);
    expect(onTick.mock.calls).toEqual([['visible']]);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(feedCalls()).toBe(1);
    queueDefaultSidebar(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(feedCalls()).toBe(2);
  });
});

describe('sidebar polling timer reset on applied counts', () => {
  beforeEach(setupPollingTest);
  afterEach(teardownPollingTest);

  it('resets the 60 s timer on applied counts refresh, not on failed counts GET', async () => {
    stopPolling = sidebarRefresh.mountSidebarRefresh();

    await vi.advanceTimersByTimeAsync(40_000);
    queueDefaultSidebar(5);
    await ctx.state.refreshSidebar();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(feedCalls()).toBe(1);

    queueDefaultSidebar(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(feedCalls()).toBe(2);

    await vi.advanceTimersByTimeAsync(40_000);
    ctx.queue({ items: [] });
    ctx.queue({ items: [] });
    ctx.fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Err' }, 500));
    ctx.fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Err' }, 500));
    await ctx.state.refreshSidebar();

    queueDefaultSidebar(7);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feedCalls()).toBe(4);
  });
});

describe('sidebar refresh session clear cleanup', () => {
  beforeEach(setupPollingTest);
  afterEach(teardownPollingTest);

  it('clears timers, listeners, and in-flight refresh owner on session clear', async () => {
    stopPolling = sidebarRefresh.mountSidebarRefresh();
    const onTick = vi.fn();
    sidebarRefresh.onLibraryTick(onTick);
    const stale = ctx.queueDeferredSidebar({ saved: 9 });
    const inflight = ctx.state.refreshSidebar();

    await vi.advanceTimersByTimeAsync(30_000);
    ctx.state.markUnauthenticated();

    stale.resolve();
    await inflight;
    expect(ctx.state.savedUnreadCount()).toBe(0);

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(feedCalls()).toBe(1);

    stopPolling = sidebarRefresh.mountSidebarRefresh();
    queueDefaultSidebar();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(feedCalls()).toBe(2);
    expect(onTick).not.toHaveBeenCalled();
  });
});

const setupDeferredSessionFetch = (
  harness: ReturnType<typeof createAppHarness>
) => {
  const session = Promise.withResolvers<Response>();
  const initialBoundary = uuid(10);
  const liveBoundary = uuid(11);
  let listRequests = 0;
  harness.respond((url) => {
    if (url === '/api/auth/session') return session.promise;
    if (!url.startsWith('/api/saved-pages/order')) return undefined;

    listRequests += 1;
    return harnessJson({
      ids: [],
      boundary: listRequests === 1 ? initialBoundary : liveBoundary,
    });
  });

  return {
    initialBoundary,
    liveBoundary,
    resolveSession: () => session.resolve(harnessJson({ authenticated: true })),
  };
};

const SIDEBAR_URLS = new Set([
  '/api/feeds',
  '/api/feeds/unread-counts',
  '/api/folders',
  '/api/saved-pages/unread-count',
]);

const countSidebarCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(([url]) => SIDEBAR_URLS.has(String(url))).length;

const libraryRequestCounts = (fetchMock: ReturnType<typeof vi.fn>) => ({
  feeds: () =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/feeds').length,
  orders: () =>
    fetchMock.mock.calls.filter(([url]) =>
      /^\/api\/(saved-pages|feed-items|(feeds|folders)\/[^/]+\/items)\/order(\?|$)/.test(
        String(url)
      )
    ).length,
});

const expectSidebarTickWithoutLiveList = async (
  harness: ReturnType<typeof createAppHarness>,
  feeds: number,
  orders: number
): Promise<void> => {
  const { mountSidebarRefresh } = await import('../src/state/sidebar-refresh');
  // Enable the mount gate without registering another live-list listener.
  const untrack = harness.modules.state.trackLibraryMount();
  const stopPolling = mountSidebarRefresh();
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    const counts = libraryRequestCounts(harness.fetchMock);
    expect(counts.feeds()).toBe(feeds + 1);
    expect(counts.orders()).toBe(orders);
  } finally {
    stopPolling();
    untrack();
  }
};

const verifyLibraryPollingLifecycle = async (
  harness: ReturnType<typeof createAppHarness>
): Promise<void> => {
  vi.useFakeTimers();
  const session = setupDeferredSessionFetch(harness);
  const { feeds, orders } = libraryRequestCounts(harness.fetchMock);
  const { listBoundary } = harness.modules.state;
  const { history } = harness.mountApp('/login');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(feeds()).toBe(0);
  expect(orders()).toBe(0);
  expect(history.get()).toBe('/login');

  history.set({ value: '/later' });
  harness.modules.solid.flush();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(feeds()).toBe(0);
  expect(orders()).toBe(0);

  session.resolveSession();
  await vi.advanceTimersByTimeAsync(10);
  harness.modules.solid.flush();
  await vi.waitFor(() => expect(feeds()).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() => expect(orders()).toBeGreaterThanOrEqual(1));
  await vi.waitFor(() => expect(listBoundary()).toBe(session.initialBoundary));
  const initialFeeds = feeds();
  const initialOrders = orders();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(feeds()).toBe(initialFeeds + 1);
  await vi.waitFor(() => expect(orders()).toBe(initialOrders + 1));
  expect(listBoundary()).toBe(session.liveBoundary);

  history.set({ value: '/settings' });
  harness.modules.solid.flush();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(history.get()).toBe('/settings');
  expect(feeds()).toBe(initialFeeds + 1);
  expect(orders()).toBe(initialOrders + 1);
  await expectSidebarTickWithoutLiveList(
    harness,
    initialFeeds + 1,
    initialOrders + 1
  );
};

describe('library page polling lifecycle', () => {
  const harness = createAppHarness({ settleTimes: 3 });
  harness.installHarnessLifecycle();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts polling only after SessionGuard verifies auth and stops on unmount', () =>
    verifyLibraryPollingLifecycle(harness));
});

describe('polling stays off outside the library page', () => {
  const harness = createAppHarness({ settleTimes: 3 });
  harness.installHarnessLifecycle();

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['/settings', '/save'])(
    'never polls sidebar counts on %s',
    async (path) => {
      vi.useFakeTimers();
      const { history } = harness.mountApp(path);
      await vi.advanceTimersByTimeAsync(10);
      harness.modules.solid.flush();

      expect(history.get()).toBe(path);
      const urls = harness.fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls).toContain('/api/auth/session');

      await vi.advanceTimersByTimeAsync(180_000);
      expect(countSidebarCalls(harness.fetchMock)).toBe(0);
    }
  );
});
