import { beforeEach, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse,
  makeItem,
  makePage,
  savedOrder,
  uuid,
} from './support/state-fixture';

const ctx = createStateTestContext();
const pages = Array.from({ length: 31 }, (_, index) =>
  makePage({ id: uuid(31 - index) })
);
const boundary = uuid(100);

beforeEach(ctx.reset);

it('publishes the snapshot boundary before the first batch settles and loads IDs in chunks of 30', async () => {
  const { state } = ctx;
  ctx.queue(savedOrder(pages, boundary));
  const first = ctx.pending();
  const initial = state.loadScopeFirstPage({ kind: 'later' }, true);
  await vi.waitFor(() => expect(state.listBoundary()).toBe(boundary));
  expect(state.loadingInitial()).toBe(true);
  expect(state.rowIds()).toHaveLength(0);
  expect(ctx.requestUrl()).toBe('/api/saved-pages/order?unread=true');
  expect(ctx.requestUrl(1)).toBe(
    `/api/saved-pages?ids=${pages
      .slice(0, 30)
      .map(({ id }) => id)
      .join(',')}`
  );

  first.resolve(jsonResponse({ items: pages.slice(0, 30).reverse() }));
  await initial;
  expect(state.rowIds()).toEqual(pages.slice(0, 30).map(({ id }) => id));

  ctx.queue({ items: pages.slice(30) });
  await Promise.all([state.loadMore(), state.loadMore()]);
  expect(state.rowIds()).toEqual(pages.map(({ id }) => id));
  expect(ctx.requestUrl(2)).toBe(`/api/saved-pages?ids=${pages[30].id}`);
  expect(state.listBoundary()).toBe(boundary);
  await state.loadMore();
  expect(ctx.fetchCount()).toBe(3);
});

it('continues through a batch with no visible rows', async () => {
  const { state } = ctx;
  const items = pages.map(({ id }) => makeItem({ id, feedId: uuid(101) }));
  ctx.queue(feedOrder(items, boundary));
  ctx.queue({ items: [] });
  ctx.queue({ items: items.slice(30) });
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  expect(state.rowIds()).toEqual([items[30].id]);
  expect(state.groupStartIds()).toEqual(new Set([items[30].id]));
  expect(ctx.fetchCount()).toBe(3);
});

it.each([false, true])(
  'retries a failed batch with loaded rows = %s',
  async (loaded) => {
    const { state } = ctx;
    ctx.queue(savedOrder(pages, boundary));
    if (loaded) ctx.queue({ items: pages.slice(0, 30) });
    ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    if (loaded) await state.loadMore();

    expect(state.rowIds()).toHaveLength(loaded ? 30 : 0);
    expect(state.loadError()).toBe('SavedPageRepositoryError');
    expect(state.listBoundary()).toBe(boundary);
    const failed = ctx.fetchCount() - 1;
    ctx.queue({ items: loaded ? pages.slice(30) : pages.slice(0, 30) });
    await state.retryLoad();
    expect(ctx.requestUrl(failed + 1)).toBe(ctx.requestUrl(failed));
    expect(state.rowIds()).toHaveLength(loaded ? 31 : 30);
    expect(state.loadError()).toBeNull();
  }
);

it('retries the order request after a snapshot failure', async () => {
  const { state } = ctx;
  ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  expect(state.listBoundary()).toBeNull();
  ctx.queue(savedOrder([], boundary));
  await state.retryLoad();
  expect(ctx.requestUrl(1)).toBe(ctx.requestUrl());
  expect(state.listBoundary()).toBe(boundary);
  expect(state.loadError()).toBeNull();
});

it('ignores a stale batch after another scope loads', async () => {
  const { state } = ctx;
  ctx.queue(savedOrder(pages, boundary));
  const late = ctx.pending();
  const first = state.loadScopeFirstPage({ kind: 'later' }, false);
  await vi.waitFor(() => expect(ctx.fetchCount()).toBe(2));
  ctx.queue(feedOrder([], uuid(102)));
  await state.loadScopeFirstPage({ kind: 'all' }, true);
  late.resolve(jsonResponse({ items: pages.slice(0, 30) }));
  await first;
  expect(state.activeScope()).toEqual({ kind: 'all' });
  expect(state.rowIds()).toEqual([]);
  expect(state.listBoundary()).toBe(uuid(102));
});
