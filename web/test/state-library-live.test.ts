import { expect, it, vi } from 'vitest';
import {
  ctx,
  feed,
  feedItem,
  first,
  folder,
  initialBoundary,
  later,
  liveBoundary,
  loadLater,
  orderCalls,
  readWindow,
  second,
  settle,
  snapshot,
  startLiveRequest,
  third,
  windowCalls,
} from './support/library-live-fixture';
import {
  feedOrder,
  jsonResponse,
  makeItem,
  savedOrder,
  uuid,
} from './support/state-fixture';
import { deferViewTransitions } from './support/view-transition';

it('replaces IDs in server order on a periodic tick and refetches the cached window once', async () => {
  await loadLater();
  await readWindow([second, first]);
  const generation = snapshot.requestState.generation;
  const revision = snapshot.listRevision();
  ctx.queue(savedOrder([third, first], liveBoundary));
  ctx.queueSidebar();
  ctx.queue({ items: [third, { ...first, read: true }] });
  await vi.advanceTimersByTimeAsync(60_000);

  expect(ctx.state.rowIds()).toEqual([third.id, first.id]);
  expect(ctx.state.listBoundary()).toBe(liveBoundary);
  expect(snapshot.requestState.generation).toBe(generation);
  expect(snapshot.listRevision()).toBe(revision + 1);
  expect(ctx.state.snapshotLoading()).toBe(false);
  await vi.waitFor(() =>
    expect(ctx.state.articleById(first.id)?.read).toBe(true)
  );
  expect(windowCalls()).toHaveLength(2);
  expect(decodeURIComponent(windowCalls()[1])).toBe(
    `/api/saved-pages?ids=${third.id},${first.id}`
  );
});

it('updates the boundary and refetches content when IDs are identical, preserving array identity and revision', async () => {
  await loadLater();
  await readWindow([second, first]);
  const ids = snapshot.snapshotIds();
  const keys = ctx.state.rowIds();
  const revision = snapshot.listRevision();
  const pending = startLiveRequest();
  ctx.queue({ items: [second, first] });
  pending.resolve(jsonResponse(savedOrder([second, first], liveBoundary)));
  await settle();

  expect(ctx.state.listBoundary()).toBe(liveBoundary);
  expect(snapshot.snapshotIds()).toBe(ids);
  expect(ctx.state.rowIds()).toBe(keys);
  expect(snapshot.listRevision()).toBe(revision);
  expect(windowCalls()).toHaveLength(2);
});

it('keeps the routed read article under the unread filter and drops it once another article is routed (LIB-FILTER-1)', async () => {
  ctx.state.setRouteArticleId(second.id);
  try {
    await loadLater(true);
    await readWindow([second, first]);
    ctx.queue({ item: second });
    ctx.queueEmpty();
    ctx.queueSidebar();
    await ctx.state.openArticleByRoute(later, second.id);
    await settle();
    expect(ctx.state.openArticle()?.read).toBe(true);

    const kept = startLiveRequest();
    ctx.queue({ items: [second, first] });
    kept.resolve(jsonResponse(savedOrder([second, first], liveBoundary)));
    await settle();

    expect(orderCalls()).toEqual(
      Array(2).fill(`/api/saved-pages/order?unread=true&keep=${second.id}`)
    );
    expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
    expect(ctx.state.adjacentArticleIds()).toEqual({
      prevId: null,
      nextId: first.id,
    });

    ctx.state.setRouteArticleId(first.id);
    const dropped = startLiveRequest();
    ctx.queue({ items: [first] });
    dropped.resolve(jsonResponse(savedOrder([first], liveBoundary)));
    await settle();

    expect(orderCalls()[2]).toBe(
      `/api/saved-pages/order?unread=true&keep=${first.id}`
    );
    expect(ctx.state.rowIds()).toEqual([first.id]);
  } finally {
    ctx.state.setRouteArticleId(null);
  }
});

it('keeps a local read intent that arrives during the refreshed content request', async () => {
  await loadLater();
  await readWindow([second, first]);
  const pending = startLiveRequest();
  const content = ctx.pending();
  pending.resolve(jsonResponse(savedOrder([second, first], liveBoundary)));
  await settle();
  expect(windowCalls()).toHaveLength(2);

  const write = ctx.pending();
  const toggle = ctx.state.toggleArticleRead(first.id, true);
  content.resolve(
    jsonResponse({ items: [{ ...first, title: 'Refreshed' }, second] })
  );
  await settle();
  expect(ctx.state.articleById(first.id)).toMatchObject({
    title: 'Refreshed',
    read: true,
  });
  expect(windowCalls()).toHaveLength(2);

  ctx.queueSidebar();
  write.resolve(new Response(null, { status: 204 }));
  await toggle;
  await settle();
});

it('ignores an omission from an older content request once the live snapshot is accepted', async () => {
  await loadLater();
  const olderWindow = ctx.pending();
  ctx.state.requestWindow({ start: 0, end: 1 });
  const pending = startLiveRequest();
  pending.resolve(jsonResponse(savedOrder([third, first], liveBoundary)));
  await settle();
  expect(ctx.state.listBoundary()).toBe(liveBoundary);

  ctx.queue({ items: [third, first] });
  olderWindow.resolve(jsonResponse({ items: [second] }));
  await settle();
  expect(ctx.state.rowIds()).toEqual([third.id, first.id]);
  await vi.waitFor(() =>
    expect(ctx.state.articleById(first.id)?.id).toBe(first.id)
  );
  expect(windowCalls()).toHaveLength(2);
});

it('discards a response after a folder move and overlays the pending move on the next snapshot', async () => {
  ctx.queue(feedOrder([feedItem], initialBoundary));
  await ctx.state.loadScopeFirstPage(folder, false);
  const stale = startLiveRequest();
  const move = ctx.pending();
  const moving = ctx.state.moveFeedToFolder(feed, null);
  stale.resolve(jsonResponse(feedOrder([feedItem], liveBoundary)));
  await settle();
  expect(ctx.state.listBoundary()).toBe(initialBoundary);
  expect(ctx.state.rowIds()).toEqual([]);

  const fresh = startLiveRequest();
  const remaining = makeItem({ id: uuid(23), feedId: uuid(24) });
  fresh.resolve(jsonResponse(feedOrder([feedItem, remaining], liveBoundary)));
  await settle();
  expect(ctx.state.listBoundary()).toBe(liveBoundary);
  expect(snapshot.snapshotIds()).toEqual([feedItem.id, remaining.id]);
  expect(ctx.state.rowIds()).toEqual([remaining.id]);

  move.resolve(new Response(null, { status: 204 }));
  await moving;
});

it('shows a feed moved back remotely after the local move has settled', async () => {
  ctx.queue(feedOrder([feedItem], initialBoundary));
  await ctx.state.loadScopeFirstPage(folder, false);
  ctx.queueEmpty();
  await ctx.state.moveFeedToFolder(feed, null);
  expect(ctx.state.rowIds()).toEqual([]);

  const fresh = startLiveRequest();
  fresh.resolve(jsonResponse(feedOrder([feedItem], liveBoundary)));
  await settle();

  expect(ctx.state.listBoundary()).toBe(liveBoundary);
  expect(ctx.state.rowIds()).toEqual([feedItem.id]);
});

it('discards a live folder response dispatched before the pending move settled', async () => {
  ctx.queue(feedOrder([feedItem], initialBoundary));
  await ctx.state.loadScopeFirstPage(folder, false);
  const move = ctx.pending();
  const moving = ctx.state.moveFeedToFolder(feed, null);
  const stale = startLiveRequest();
  move.resolve(new Response(null, { status: 204 }));
  await moving;
  expect(ctx.state.rowIds()).toEqual([]);

  stale.resolve(jsonResponse(feedOrder([feedItem], liveBoundary)));
  await settle();

  expect(ctx.state.listBoundary()).toBe(initialBoundary);
  expect(ctx.state.rowIds()).toEqual([]);
});

it('keeps a failed live snapshot silent and retries on the next tick', async () => {
  await loadLater();
  const pending = startLiveRequest();
  pending.resolve(jsonResponse({ error: 'SavedPageRepositoryError' }, 500));
  await settle();

  expect(ctx.state.listBoundary()).toBe(initialBoundary);
  expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
  expect(ctx.state.snapshotError()).toBeNull();
  expect(ctx.state.windowError()).toBeNull();
  expect(ctx.ui.currentToast()).toBeNull();

  const retry = startLiveRequest();
  retry.resolve(jsonResponse(savedOrder([third], liveBoundary)));
  await settle();
  expect(ctx.state.rowIds()).toEqual([third.id]);
});

const deferLiveTransitions = () =>
  deferViewTransitions(ctx.ui, async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

it('commits a changed live snapshot inside a list transition', async () => {
  await loadLater();
  await readWindow([second, first]);
  const { transition, restore } = deferLiveTransitions();
  try {
    const pending = startLiveRequest();
    pending.resolve(jsonResponse(savedOrder([third, first], liveBoundary)));
    await settle();
    expect(ctx.state.rowIds()).toEqual([second.id, first.id]);

    ctx.queue({ items: [third, first] });
    await transition.runUpdate();
    await settle();
    expect(ctx.state.rowIds()).toEqual([third.id, first.id]);
    expect(ctx.state.listBoundary()).toBe(liveBoundary);
    await vi.waitFor(() => expect(windowCalls()).toHaveLength(2));
  } finally {
    restore();
  }
});

it('discards a live snapshot whose guards change before the transition update runs', async () => {
  await loadLater();
  await readWindow([second, first]);
  const { transition, restore } = deferLiveTransitions();
  try {
    const pending = startLiveRequest();
    pending.resolve(jsonResponse(savedOrder([third, first], liveBoundary)));
    await settle();
    expect(transition.started).toBe(1);

    snapshot.invalidateLiveSnapshot();
    ctx.solid.flush();
    await transition.runUpdate();
    await settle();
    expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
    expect(ctx.state.listBoundary()).toBe(initialBoundary);
    expect(windowCalls()).toHaveLength(1);
  } finally {
    restore();
  }
});

it('discards a live snapshot requested with the previous routed article (LIB-FILTER-1)', async () => {
  ctx.state.setRouteArticleId(second.id);
  try {
    await loadLater(true);
    await readWindow([second, first]);
    const pending = startLiveRequest();
    ctx.state.setRouteArticleId(first.id);
    pending.resolve(jsonResponse(savedOrder([first], liveBoundary)));
    await settle();

    expect(orderCalls()[1]).toBe(
      `/api/saved-pages/order?unread=true&keep=${second.id}`
    );
    expect(ctx.state.rowIds()).toEqual([second.id, first.id]);
    expect(ctx.state.listBoundary()).toBe(initialBoundary);
  } finally {
    ctx.state.setRouteArticleId(null);
  }
});
