import { describe, expect, it, vi } from 'vitest';
import {
  B2,
  ctx,
  deferTransitions,
  first,
  folderId,
  later,
  loadFolder,
  loadLater,
  motion,
  second,
  snapshotModule,
  staysItem,
  third,
} from './support/motion-fixture';
import { feedOrder, jsonResponse, savedOrder } from './support/state-fixture';

describe('in-place reload', () => {
  it('keeps the current rows and their records on screen until the fresh snapshot replaces them', async () => {
    const { state, solid } = ctx;
    await loadLater();
    const order = ctx.pending();
    const reload = (await motion()).reloadScopeInPlace(later, false);
    solid.flush();
    expect(state.rowIds()).toEqual([second.id, first.id]);
    expect(state.snapshotLoading()).toBe(true);

    ctx.queue({ items: [third, first] });
    order.resolve(jsonResponse(savedOrder([third, first], B2)));
    await reload;
    solid.flush();

    expect(state.rowIds()).toEqual([third.id, first.id]);
    expect(state.listBoundary()).toBe(B2);
    expect(state.snapshotLoading()).toBe(false);
    expect(state.articleById(first.id)).not.toBeNull();
  });

  it('falls back to a full reload when the list changes while the snapshot is in flight', async () => {
    const { state, solid } = ctx;
    await loadLater();
    const order = ctx.pending();
    const reload = (await motion()).reloadScopeInPlace(later, false);
    await state.removeSavedPageLocal(second.id);
    solid.flush();

    ctx.queue(savedOrder([third], B2));
    ctx.queue({ items: [third] });
    order.resolve(jsonResponse(savedOrder([second, first], B2)));
    await reload;
    solid.flush();

    expect(
      ctx.fetchMock.mock.calls.filter(([url]) => String(url).includes('/order'))
    ).toHaveLength(3);
    expect(state.rowIds()).toEqual([third.id]);
  });
});

it('falls back to a full reload when the routed article changes during an in-place reload', async () => {
  const { state, solid } = ctx;
  await ctx.queueLoadedLibrary({
    scope: later,
    items: [second, first],
    unreadOnly: true,
  });
  state.setRouteArticleId(second.id);
  try {
    const stale = ctx.pending();
    const reload = (await motion()).reloadScopeInPlace(later, true);
    state.setRouteArticleId(first.id);
    ctx.queue(savedOrder([first], B2));
    ctx.queue({ items: [first] });
    stale.resolve(jsonResponse(savedOrder([second], B2)));
    await reload;
    solid.flush();

    const orders = ctx.fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/order'));
    expect(orders.at(-1)).toBe(
      `/api/saved-pages/order?unread=true&keep=${first.id}`
    );
    expect(state.rowIds()).toEqual([first.id]);
  } finally {
    state.setRouteArticleId(null);
  }
});

describe('in-place reload fallbacks and motion', () => {
  it('falls back to the full reload, which reports the error, when the snapshot request fails', async () => {
    const { state, solid } = ctx;
    await loadLater();
    ctx.queue({ error: 'RequestFailed' }, 500);
    ctx.queue({ error: 'RequestFailed' }, 500);
    await (await motion()).reloadScopeInPlace(later, false);
    solid.flush();

    expect(state.rowIds()).toEqual([]);
    expect(state.snapshotError()).not.toBeNull();
  });

  it('commits the fresh snapshot inside a list transition', async () => {
    const { state, solid } = ctx;
    await loadLater();
    const transition = deferTransitions();
    const order = ctx.pending();
    const reload = (await motion()).reloadScopeInPlace(later, false);
    ctx.queue({ items: [third, first] });
    order.resolve(jsonResponse(savedOrder([third, first], B2)));
    await vi.waitFor(() => expect(transition.started).toBe(1));
    expect(state.rowIds()).toEqual([second.id, first.id]);

    await transition.runUpdate();
    await reload;
    solid.flush();
    expect(state.rowIds()).toEqual([third.id, first.id]);
  });
});

it('keeps fetching content after an identical in-place reload interrupts a layout wait', async () => {
  const { state, solid } = ctx;
  await loadLater();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  try {
    const { reloadScopeInPlace } = await motion();
    ctx.queue(savedOrder([third, second, first], B2));
    await reloadScopeInPlace(later, false);
    solid.flush();
    expect(state.rowIds()).toEqual([third.id, second.id, first.id]);

    ctx.queue(savedOrder([third, second, first], B2));
    ctx.queue({ items: [third, second, first] });
    const before = ctx.fetchCount();
    await reloadScopeInPlace(later, false);
    await vi.waitFor(() =>
      expect(ctx.requestUrl(before + 1)).toContain('/api/saved-pages?ids=')
    );
  } finally {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', ctx.fetchMock);
  }
});

describe('deferred saved-page removal', () => {
  it('skips a deferred saved-page removal once the list left Read Later', async () => {
    const { state, solid } = ctx;
    await loadLater();
    const transition = deferTransitions();
    const removing = state.removeSavedPageLocal(second.id);
    ctx.queue(feedOrder([], B2));
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    const revision = (await snapshotModule()).listRevision();

    await transition.runUpdate();
    await removing;
    solid.flush();
    expect((await snapshotModule()).listRevision()).toBe(revision);
  });

  it('removes a deleted saved page when the list transition update runs', async () => {
    const { state, solid } = ctx;
    await loadLater();
    const transition = deferTransitions();
    const removing = state.removeSavedPageLocal(second.id);
    solid.flush();
    expect(state.rowIds()).toEqual([second.id, first.id]);

    await transition.runUpdate();
    await removing;
    solid.flush();
    expect(state.rowIds()).toEqual([first.id]);
  });
});

it('reloads a feed snapshot in place for grouped scopes', async () => {
  const { state, solid } = ctx;
  await loadFolder();
  ctx.queue(feedOrder([staysItem], B2));
  await (await motion()).reloadScopeInPlace(
    { kind: 'folder', folderId },
    false
  );
  solid.flush();
  expect(state.rowIds()).toEqual([staysItem.id]);
  expect(state.articleById(staysItem.id)).not.toBeNull();
});
