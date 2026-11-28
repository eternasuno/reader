import { expect, it, vi } from 'vitest';
import {
  becomeVisible,
  ctx,
  feed,
  feedItem,
  first,
  initialBoundary,
  later,
  live,
  liveBoundary,
  loadLater,
  mountLive,
  orderCalls,
  queueIdle,
  second,
  setHidden,
  settle,
  snapshot,
  startLiveRequest,
  third,
  unmountLive,
  untrackLibrary,
} from './support/library-live-fixture';
import {
  feedOrder,
  jsonResponse,
  savedOrder,
  uuid,
} from './support/state-fixture';

it('discards a live response while a newer list generation is still loading', async () => {
  await loadLater();
  const pending = startLiveRequest();
  const reloadBoundary = uuid(12);
  const reload = ctx.pending();
  const revision = snapshot.listRevision();
  const loading = ctx.state.loadScopeFirstPage(later, true);
  expect(snapshot.listRevision()).toBe(revision);

  pending.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();

  expect(ctx.state.listBoundary()).toBeNull();
  expect(ctx.state.rowIds()).toEqual([]);

  reload.resolve(jsonResponse(savedOrder([first], reloadBoundary)));
  await loading;
  expect(ctx.state.listBoundary()).toBe(reloadBoundary);
  expect(ctx.state.rowIds()).toEqual([first.id]);
});

it.each([
  {
    change: 'prepended',
    mutate: () => ctx.state.insertSavedPageLocal(third),
    ids: [third.id, second.id, first.id],
  },
  {
    change: 'removed',
    mutate: () => ctx.state.removeSavedPageLocal(second.id),
    ids: [first.id],
  },
])(
  'discards a live response when a saved page was $change during the request',
  async ({ mutate, ids }) => {
    await loadLater();
    const pending = startLiveRequest();
    mutate();
    pending.resolve(jsonResponse(savedOrder([second], liveBoundary)));
    await settle();

    expect(ctx.state.listBoundary()).toBe(initialBoundary);
    expect(ctx.state.rowIds()).toEqual(ids);
  }
);

it('discards a live response containing a deleted saved page absent from the unread list', async () => {
  await loadLater(true);
  const pending = startLiveRequest();
  expect(ctx.state.rowIds()).not.toContain(third.id);

  ctx.state.removeSavedPageLocal(third.id);
  pending.resolve(
    jsonResponse(savedOrder([third, second, first], liveBoundary))
  );
  await settle();

  expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
  expect(ctx.state.listBoundary()).toBe(initialBoundary);
});

it('discards a live response when a read toggle enqueued during it has already drained', async () => {
  await loadLater();
  const pending = startLiveRequest();
  ctx.queueEmpty();
  ctx.queueSidebar();
  await ctx.state.toggleArticleRead(first.id, true);
  await settle();
  expect(queueIdle()).toBe(true);

  pending.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();
  expect(ctx.state.listBoundary()).toBe(initialBoundary);
  expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
});

it.each([
  { reason: 'the page is hidden', invalidate: () => setHidden(true) },
  {
    reason: 'the library unmounted',
    invalidate: () => {
      untrackLibrary();
    },
  },
  {
    reason: 'the live subscription unmounted',
    invalidate: () => unmountLive(),
  },
])('discards a live response when $reason', async ({ invalidate }) => {
  await loadLater();
  const pending = startLiveRequest();
  invalidate();
  pending.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();

  expect(ctx.state.listBoundary()).toBe(initialBoundary);
  expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
});

it('invalidates the in-flight result on session clear and resumes after remount', async () => {
  await loadLater();
  const stale = startLiveRequest();
  ctx.state.markUnauthenticated();
  stale.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();
  expect(ctx.state.listBoundary()).toBeNull();
  expect(ctx.state.rowIds()).toEqual([]);

  await mountLive();
  await loadLater();
  const fresh = startLiveRequest();
  fresh.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();
  expect(ctx.state.rowIds()).toEqual([third.id]);
});

it('skips ticks before a snapshot is accepted and while loading', async () => {
  ctx.queueSidebar();
  becomeVisible();
  await settle();
  expect(orderCalls()).toHaveLength(0);

  const initial = ctx.pending();
  const load = ctx.state.loadScopeFirstPage(later, false);
  expect(ctx.state.snapshotLoading()).toBe(true);
  ctx.queueSidebar();
  becomeVisible();
  await settle();
  expect(orderCalls()).toHaveLength(1);

  initial.resolve(jsonResponse(savedOrder([first], initialBoundary)));
  await load;
  expect(ctx.state.rowIds()).toEqual([first.id]);
});

it('skips a visibility tick while the read queue is busy', async () => {
  await loadLater();
  const write = ctx.pending();
  const toggle = ctx.state.toggleArticleRead(first.id, true);
  expect(queueIdle()).toBe(false);
  ctx.queueSidebar();
  becomeVisible();
  await settle();
  expect(orderCalls()).toHaveLength(1);

  ctx.queueSidebar();
  write.resolve(new Response(null, { status: 204 }));
  await toggle;
  await settle();
});

it('skips ticks during a first-refresh wait and resumes after that wait settles', async () => {
  ctx.queue(feedOrder([], initialBoundary));
  await ctx.state.loadScopeFirstPage({ kind: 'feed', feedId: feed.id }, false);
  const library = await import('../src/state/library');
  library.startFirstRefreshWait(feed.id);
  expect(library.isFirstRefreshWaiting()).toBe(true);
  ctx.queueSidebar();
  becomeVisible();
  await settle();
  expect(orderCalls()).toHaveLength(1);

  ctx.queue({ items: [] });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(library.isFirstRefreshWaiting()).toBe(false);
  const pending = startLiveRequest();
  pending.resolve(jsonResponse(feedOrder([feedItem], liveBoundary)));
  await settle();
  expect(ctx.state.rowIds()).toEqual([feedItem.id]);
});

it('drops visibility bursts while one live request is in flight and keeps the remaining mount subscribed', async () => {
  await loadLater();
  const releaseExtraMount = live.mountLiveList();
  releaseExtraMount();
  const pending = startLiveRequest();
  becomeVisible();
  await settle();
  ctx.queueSidebar();
  becomeVisible();
  await settle();
  expect(orderCalls()).toHaveLength(2);

  pending.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();
  expect(ctx.state.rowIds()).toEqual([third.id]);
  expect(orderCalls()).toHaveLength(2);
});
