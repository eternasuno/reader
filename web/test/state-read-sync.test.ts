import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarrierTarget, ReadBarrier } from '../src/state/read-sync';
import { routeDeferredWrites } from './support/mark-all-routes';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makePage,
  noContentResponse,
} from './support/state-fixture';

type ReadSyncMod = typeof import('../src/state/read-sync');
type SidebarRefreshMod = typeof import('../src/state/sidebar-refresh');

const ctx = createStateTestContext();
let readSync: ReadSyncMod;
let sidebarRefresh: SidebarRefreshMod;

beforeEach(async () => {
  await ctx.reset();
  readSync = await import('../src/state/read-sync');
  sidebarRefresh = await import('../src/state/sidebar-refresh');
});

const loadPages = async (
  items: Array<ReturnType<typeof makePage>>
): Promise<number> => {
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
const pageTarget = (id: string, read = false) => ({
  id,
  kind: 'later' as const,
  feedId: null,
  read,
});

const deferredBarrier = (affects: (entry: BarrierTarget) => boolean) => {
  let resolve!: (outcome: 'ok' | 'failed' | 'ambiguous') => void;
  let started = false;
  const barrier: ReadBarrier = {
    affects,
    execute: () => {
      started = true;
      return new Promise((res) => {
        resolve = res;
      });
    },
  };
  return {
    barrier,
    resolve: (outcome: 'ok' | 'failed' | 'ambiguous') => resolve(outcome),
    started: () => started,
  };
};

describe('read sync: serialization', () => {
  it('never runs concurrent writes per article and sends explicit values', async () => {
    const { state, solid } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const first = ctx.pending();
    const second = ctx.pending();

    const pRead = state.toggleArticleRead('p1', true);
    const pUnread = state.toggleArticleRead('p1', false);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ctx.requestBody(before)).toEqual({ read: true });
    expect(state.rows()[0].read).toBe(false);

    first.resolve(noContentResponse());
    await waitRequests(before + 2);
    expect(ctx.requestBody(before + 1)).toEqual({ read: false });

    second.resolve(noContentResponse());
    await expect(Promise.all([pRead, pUnread])).resolves.toEqual([false, true]);
  });
});

describe('read sync: coalescing', () => {
  it('coalesces rapid toggles into the next segment', async () => {
    const { state, solid } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const first = ctx.pending();
    const second = ctx.pending();

    const calls = [
      state.toggleArticleRead('p1', true),
      state.toggleArticleRead('p1', false),
      state.toggleArticleRead('p1', true),
      state.toggleArticleRead('p1', false),
    ];
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(ctx.requestBody(before)).toEqual({ read: true });

    first.resolve(noContentResponse());
    await waitRequests(before + 2);
    expect(ctx.requestBody(before + 1)).toEqual({ read: false });

    second.resolve(noContentResponse());
    expect(await Promise.all(calls)).toEqual([false, true, false, true]);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 2);
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('read sync: barrier ordering', () => {
  it('orders toggles around barriers without coalescing across them', async () => {
    const { state } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const first = ctx.pending();
    const afterReq = ctx.pending();
    const gate = deferredBarrier((e) => e.kind === 'later');

    const p1 = state.toggleArticleRead('p1', true);
    const barrierPromise = readSync.enqueueBarrier(gate.barrier);
    const p2 = state.toggleArticleRead('p1', false);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(gate.started()).toBe(false);

    first.resolve(noContentResponse());
    await vi.waitFor(() => expect(gate.started()).toBe(true));
    expect(ctx.fetchCount()).toBe(before + 1);

    gate.resolve('ok');
    await expect(barrierPromise).resolves.toBe('ok');
    await waitRequests(before + 2);
    expect(ctx.requestBody(before + 1)).toEqual({ read: false });

    afterReq.resolve(noContentResponse());
    await expect(Promise.all([p1, p2])).resolves.toEqual([false, true]);
  });
});

describe('read sync: definite and superseded failures', () => {
  it('is silent and changes nothing when superseded by a later intent', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const first = ctx.pending();

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    first.resolve(failure());
    expect(await Promise.all([markRead, markUnread])).toEqual([false, true]);
    solid.flush();
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()).toBeNull();
  });

  it('sends a queued unread intent after an ambiguous failure even when it equals the old confirmed value', async () => {
    const { state, solid } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const routed = routeDeferredWrites(ctx.fetchMock);
    const sent = () => routed.count('/api/saved-pages/p1');

    const markRead = state.toggleArticleRead('p1', true);
    const markUnread = state.toggleArticleRead('p1', false);
    solid.flush();
    await vi.waitFor(() => expect(sent()).toBe(1));

    routed.rejectNext('/api/saved-pages/p1');
    await vi.waitFor(() => expect(sent()).toBe(1));
    expect(ctx.requestBody(before + 1)).toEqual({ read: false });

    routed.resolveNext('/api/saved-pages/p1');
    expect(await Promise.all([markRead, markUnread])).toEqual([false, true]);
    expect(state.rows()[0].read).toBe(false);
  });
});

describe('read sync: post-barrier rollback', () => {
  it('rolls back a failed toggle after a successful barrier to true', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const gate = deferredBarrier((e) => e.kind === 'later');
    const afterReq = ctx.pending();

    const barrierPromise = readSync.enqueueBarrier(gate.barrier);
    const p1 = state.toggleArticleRead('p1', true);
    const p2 = state.toggleArticleRead('p1', false);
    gate.resolve('ok');
    await expect(barrierPromise).resolves.toBe('ok');
    await waitRequests(before + 1);

    afterReq.resolve(failure());
    await expect(Promise.all([p1, p2])).resolves.toEqual([true, false]);
    solid.flush();
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('read sync: ambiguous failure', () => {
  it('re-fetches affected rows and refreshes sidebar counts once after drain', async () => {
    const { state, solid, ui } = ctx;
    const stopPolling = sidebarRefresh.mountSidebarRefresh();
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const detail = ctx.pending();
    ctx.queueSidebar({ saved: 1 });

    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(false);
    solid.flush();
    expect(ui.currentToast()?.variant).toBe('error');
    await waitRequests(before + 6);
    expect(ctx.requestUrl(before + 1)).toBe('/api/saved-pages/p1');

    detail.resolve(jsonResponse({ item: makePage({ id: 'p1', read: true }) }));
    await vi.waitFor(() => expect(state.rows()[0].read).toBe(true));
    expect(state.savedUnreadCount()).toBe(1);
    stopPolling();
  });
});

describe('read sync: snapshot merge rule', () => {
  it('ignores pre-settle GET, applies post-settle GET, and avoids blocking', async () => {
    const { state, solid } = ctx;
    const p1Unread = {
      ...makePage({ id: 'p1', read: false }),
      kind: 'later' as const,
    };
    await loadPages([makePage({ id: 'p1', read: false })]);
    const slowUnrelated = readSync.beginRecordSnapshot();
    const staleGet = readSync.beginRecordSnapshot();

    ctx.queueEmpty();
    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(true);
    solid.flush();

    expect(readSync.mergeSnapshotRead(p1Unread, staleGet.seq)).toBe(true);
    staleGet.release();

    const freshGet = readSync.beginRecordSnapshot();
    expect(readSync.mergeSnapshotRead(p1Unread, freshGet.seq)).toBe(false);
    freshGet.release();
    slowUnrelated.release();
  });
});

describe('read sync: mark-loaded-read', () => {
  it('adjusts counts only for changed rows, chunks by 200, and avoids double-send', async () => {
    const { state, solid } = ctx;
    const before = await loadPages([
      makePage({ id: 'p1', read: false }),
      makePage({ id: 'p2', read: false }),
      makePage({ id: 'p3', read: true }),
    ]);
    const first = ctx.pending();
    const batch = ctx.pending();

    const p1Req = state.toggleArticleRead('p1', true);
    state.markLoadedRead();
    solid.flush();
    expect(state.savedUnreadCount()).toBe(0);
    expect(ctx.fetchCount()).toBe(before + 1);

    first.resolve(noContentResponse());
    await waitRequests(before + 2);
    expect(ctx.requestUrl(before + 1)).toBe('/api/saved-pages/p2');
    batch.resolve(noContentResponse());
    await p1Req;
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));

    const feedTargets = Array.from({ length: 205 }, (_, i) => ({
      id: `f-${i}`,
      kind: 'feed' as const,
      feedId: makeFeed({ id: 'feed1' }).id,
      read: false,
    }));
    const c1 = ctx.pending();
    const c2 = ctx.pending();
    readSync.requestReadMany(feedTargets);
    await waitRequests(before + 4);
    const bodyIds = (call: number) =>
      (ctx.requestBody(call) as { ids: Array<string> }).ids;
    expect(bodyIds(before + 2)).toHaveLength(200);
    expect(bodyIds(before + 3)).toHaveLength(5);
    c1.resolve(noContentResponse());
    c2.resolve(noContentResponse());
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
  });
});

describe('read sync: telemetry and session clear', () => {
  it('tracks queueIdle, queueEpoch, and onQueueDrained', async () => {
    const { state } = ctx;
    await loadPages([makePage({ id: 'p1', read: false })]);
    const req = ctx.pending();
    const drained = vi.fn();
    const off = readSync.onQueueDrained(drained);
    const startEpoch = readSync.queueEpoch();

    expect(readSync.queueIdle()).toBe(true);
    const p1 = state.toggleArticleRead('p1', true);
    expect(readSync.queueIdle()).toBe(false);
    expect(readSync.queueEpoch()).toBe(startEpoch + 1);

    req.resolve(noContentResponse());
    await p1;
    await vi.waitFor(() => expect(readSync.queueIdle()).toBe(true));
    expect(drained).toHaveBeenCalledTimes(1);
    off();
    void readSync.requestRead(pageTarget('p1', true), false);
    expect(readSync.queueEpoch()).toBe(startEpoch + 2);
  });

  it('drops queued work and suppresses toasts when session clears', async () => {
    const { state, solid, ui } = ctx;
    const before = await loadPages([makePage({ id: 'p1', read: false })]);
    const first = ctx.pending();
    const gate = deferredBarrier(() => true);

    const p1 = readSync.requestRead(pageTarget('p1', false), true);
    const barrierPromise = readSync.enqueueBarrier(gate.barrier);
    state.markUnauthenticated();
    first.resolve(failure());

    await expect(p1).resolves.toBeNull();
    await expect(barrierPromise).resolves.toBe('cleared');
    solid.flush();
    expect(readSync.queueIdle()).toBe(true);
    expect(gate.started()).toBe(false);
    expect(ctx.fetchCount()).toBe(before + 1);
    expect(state.rows()).toEqual([]);
    expect(ui.currentToast()).toBeNull();
  });
});
