import { beforeEach, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
  noContentResponse,
  savedOrder,
  uuid,
} from './support/state-fixture';

const ctx = createStateTestContext();
const pages = Array.from({ length: 450 }, (_, index) =>
  makePage({ id: uuid(450 - index) })
);
const ids = pages.map(({ id }) => id);
const boundary = uuid(2000);

beforeEach(ctx.reset);

const loadLater = async (): Promise<void> => {
  ctx.queue(savedOrder(pages, boundary));
  await ctx.state.loadScopeFirstPage({ kind: 'later' }, true);
};

const requestedIds = (call: number): Array<string> =>
  (ctx.requestUrl(call).split('?ids=')[1] ?? '').split(',');

it('publishes all IDs and the boundary immediately, then clamps and chunks the requested window', async () => {
  const { state } = ctx;
  await loadLater();
  expect(state.rowIds()).toEqual(ids);
  expect(state.listBoundary()).toBe(boundary);
  expect(state.snapshotLoading()).toBe(false);
  expect(ctx.fetchCount()).toBe(1);
  expect(state.articleById(ids[0])).toBeNull();

  ctx.queue({ items: pages.slice(0, 200).reverse() });
  ctx.queue({ items: pages.slice(200, 221) });
  state.requestWindow({ start: 0, end: 200 });
  expect(requestedIds(1)).toEqual(ids.slice(0, 200));
  await vi.waitFor(() => expect(state.articleById(ids[220])).not.toBeNull());
  expect(requestedIds(2)).toEqual(ids.slice(200, 221));
  expect(state.articleById(ids[221])).toBeNull();
  expect(state.rowIds()).toEqual(ids);
});

it('services only the latest pending range and clamps right padding at the list end', async () => {
  const { state } = ctx;
  await loadLater();
  const first = ctx.pending();
  state.requestWindow({ start: 30, end: 130 });
  expect(requestedIds(1)).toEqual(ids.slice(10, 151));
  state.requestWindow({ start: 250, end: 300 });
  state.requestWindow({ start: 449, end: 449 });
  expect(ctx.fetchCount()).toBe(2);

  ctx.queue({ items: pages.slice(429) });
  first.resolve(jsonResponse({ items: pages.slice(10, 151) }));
  await vi.waitFor(() => expect(state.articleById(ids[449])).not.toBeNull());
  expect(requestedIds(2)).toEqual(ids.slice(429));
  expect(ctx.fetchCount()).toBe(3);
  expect(state.articleById(ids[250])).toBeNull();
});

it('drops omissions, revises the list, and recomputes the window and group start', async () => {
  const { state } = ctx;
  const items = pages
    .slice(0, 22)
    .map(({ id }) => makeItem({ id, feedId: uuid(501) }));
  ctx.queue(feedOrder(items, boundary));
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  expect(state.groupStartIds()).toEqual(new Set([items[0].id]));
  expect(state.feedIdOf(items[0].id)).toBe(uuid(501));
  expect(state.listRevision()).toBe(1);
  ctx.queue({ items: items.slice(1, 21) });
  ctx.queue({ items: items.slice(21) });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() =>
    expect(state.articleById(items[21].id)).not.toBeNull()
  );
  expect(state.rowIds()).toEqual(ids.slice(1, 22));
  expect(state.listRevision()).toBe(2);
  expect(state.groupStartIds()).toEqual(new Set([items[1].id]));
  expect(state.feedIdOf(items[0].id)).toBeNull();
});

it('retries window failures without removing skeleton IDs', async () => {
  const { state } = ctx;
  await loadLater();
  ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() =>
    expect(state.windowError()).toBe('SavedPageRepositoryError')
  );
  expect(state.rowIds()).toEqual(ids);
  expect(state.snapshotError()).toBeNull();
  expect(state.articleById(ids[0])).toBeNull();
  ctx.queue({ items: pages.slice(0, 21) });
  await state.retryLoad();
  expect(requestedIds(2)).toEqual(requestedIds(1));
  expect(state.articleById(ids[0])).not.toBeNull();
  expect(state.windowError()).toBeNull();
});

it('retries the order request after a snapshot failure', async () => {
  const { state } = ctx;
  ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  expect(state.listBoundary()).toBeNull();
  expect(state.snapshotError()).toBe('SavedPageRepositoryError');
  ctx.queue(savedOrder([], boundary));
  await state.retryLoad();
  expect(ctx.requestUrl(1)).toBe(ctx.requestUrl());
  expect(state.listBoundary()).toBe(boundary);
  expect(state.snapshotError()).toBeNull();
});

it('discards stale content and omissions after a generation change', async () => {
  const { state } = ctx;
  await loadLater();
  const { savedPagesApi } = await import('../src/api');
  const late =
    Promise.withResolvers<Awaited<ReturnType<typeof savedPagesApi.byIds>>>();
  const byIds = vi
    .spyOn(savedPagesApi, 'byIds')
    .mockReturnValueOnce(late.promise);
  state.requestWindow({ start: 0, end: 0 });
  expect(byIds).toHaveBeenCalledTimes(1);

  ctx.queue(savedOrder(pages, uuid(2001)));
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  ctx.queue({ items: pages.slice(429) });
  state.requestWindow({ start: 449, end: 449 });
  expect(byIds.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(byIds).toHaveBeenCalledTimes(1);

  late.resolve({ items: pages.slice(0, 1) });
  await vi.waitFor(() => expect(state.articleById(ids[449])).not.toBeNull());
  expect(state.rowIds()).toEqual(ids);
  expect(state.articleById(ids[0])).toBeNull();
  expect(state.listRevision()).toBe(2);
  expect(state.listBoundary()).toBe(uuid(2001));
});

it('refreshes the current window and refetches stale records when revisiting another window', async () => {
  const { state } = ctx;
  await loadLater();
  ctx.queue({ items: pages.slice(0, 21) });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.articleById(ids[0])).not.toBeNull());
  ctx.queue({ items: pages.slice(429) });
  state.requestWindow({ start: 449, end: 449 });
  await vi.waitFor(() => expect(state.articleById(ids[449])).not.toBeNull());

  ctx.queue({
    items: pages.slice(429).map((page) => ({ ...page, title: 'Refreshed' })),
  });
  state.refreshWindow();
  expect(requestedIds(3)).toEqual(ids.slice(429));
  await vi.waitFor(() =>
    expect(state.articleById(ids[449])?.title).toBe('Refreshed')
  );
  expect(state.articleById(ids[0])?.title).toBe(pages[0].title);
  ctx.queue({ items: pages.slice(0, 21) });
  state.requestWindow({ start: 0, end: 0 });
  expect(requestedIds(4)).toEqual(ids.slice(0, 21));
});

const queueBatches = (
  items: ReadonlyArray<ReturnType<typeof makeItem>>
): void => {
  for (let offset = 0; offset < items.length; offset += 200) {
    ctx.queue({ items: items.slice(offset, offset + 200) });
  }
};

const expectCachedPrefix = (
  items: ReadonlyArray<ReturnType<typeof makeItem>>
): void => {
  const cachedIds = items
    .slice(0, 10)
    .filter(({ id }) => ctx.state.articleById(id) !== null);
  expect(cachedIds.map(({ id }) => id)).toEqual(
    items.slice(0, 3).map(({ id }) => id)
  );
};

it('evicts the farthest records and preserves the reader, pending read, and moving feed pins', async () => {
  const { state } = ctx;
  const movingFeed = makeFeed({ id: uuid(2001) });
  const feed = makeFeed({ id: uuid(2002) });
  const items = Array.from({ length: 1010 }, (_, index) =>
    makeItem({
      id: uuid(index + 1),
      feedId: index === 0 ? movingFeed.id : feed.id,
    })
  );
  ctx.queue(feedOrder(items, boundary));
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  ctx.queue({ items: items.slice(0, 24) });
  state.requestWindow({ start: 0, end: 3 });
  await vi.waitFor(() =>
    expect(state.articleById(items[23].id)).not.toBeNull()
  );
  state.retainReaderArticle(items[1].id);
  const read = ctx.pending();
  const reading = state.toggleArticleRead(items[2].id, true);
  const move = ctx.pending();
  const moving = state.moveFeedToFolder(movingFeed, 'destination');
  queueBatches(items.slice(24));
  state.requestWindow({ start: 44, end: 1009 });
  await vi.waitFor(() =>
    expect(state.articleById(items[1009].id)).not.toBeNull()
  );
  expect(items.filter(({ id }) => state.articleById(id) !== null)).toHaveLength(
    1003
  );
  expectCachedPrefix(items);
  expect(state.articleById(items[10].id)).not.toBeNull();
  expect(state.rowIds()).toHaveLength(1010);

  move.resolve(noContentResponse());
  read.resolve(noContentResponse());
  await Promise.all([moving, reading]);
  ctx.solid.flush();
  expect(state.articleById(items[0].id)).toBeNull();
  expect(state.articleById(items[1].id)).not.toBeNull();
});

it('trims the cache when an older GET releases a settled read pin', async () => {
  const { state } = ctx;
  const { hasActiveEntry } = await import('../src/state/read-sync-state');
  const { queueIdle } = await import('../src/state/read-sync');
  const items = Array.from({ length: 1001 }, (_, index) =>
    makeItem({ id: uuid(index + 1), feedId: uuid(2001) })
  );
  const first = items[0].id;
  const last = items[1000].id;
  ctx.queue(feedOrder(items, boundary));
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  queueBatches(items.slice(0, 1000));
  state.requestWindow({ start: 0, end: 979 });
  await vi.waitFor(() =>
    expect(state.articleById(items[999].id)).not.toBeNull()
  );

  const get = ctx.pending();
  state.requestWindow({ start: 1000, end: 1000 });
  expect(requestedIds(6)).toEqual([last]);
  ctx.queueEmpty();
  expect(await state.toggleArticleRead(first, true)).toBe(true);
  await vi.waitFor(() => expect(queueIdle()).toBe(true));
  expect(hasActiveEntry(first)).toBe(true);

  get.resolve(jsonResponse({ items: [items[1000]] }));
  await vi.waitFor(() => expect(hasActiveEntry(first)).toBe(false));
  expect(state.articleById(last)).not.toBeNull();
  expect(items.filter(({ id }) => state.articleById(id) !== null)).toHaveLength(
    1000
  );
});

it('refetches the retained reader record after reloading the same ID', async () => {
  const { state } = ctx;
  const page = pages[0];
  ctx.queue(savedOrder([page], boundary));
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  ctx.queue({ items: [page] });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.articleById(page.id)).not.toBeNull());
  state.retainReaderArticle(page.id);

  ctx.queue(savedOrder([page], uuid(2001)));
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  expect(state.articleById(page.id)?.content).toBe(page.content);

  ctx.queue({ items: [{ ...page, content: '<p>Updated content</p>' }] });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() =>
    expect(state.articleById(page.id)?.content).toBe('<p>Updated content</p>')
  );
  expect(requestedIds(3)).toEqual([page.id]);
});

it('uses uncached snapshot neighbours and tracks the IDs through the visible end', async () => {
  const { state, solid } = ctx;
  await loadLater();
  ctx.queue({ item: { ...pages[1], read: true } });
  await state.openArticleByRoute({ kind: 'later' }, ids[1]);
  expect(state.articleById(ids[0])).toBeNull();
  expect(state.articleById(ids[2])).toBeNull();
  expect(state.adjacentArticleIds()).toEqual({
    prevId: ids[0],
    nextId: ids[2],
  });
  state.setVisibleRange({ first: 2, last: 3 });
  solid.flush();
  expect(state.idsThroughVisibleEnd()).toEqual(ids.slice(0, 4));
  state.setVisibleRange(null);
  solid.flush();
  expect(state.idsThroughVisibleEnd()).toEqual([]);
  state.removeSavedPageLocal(ids[1]);
  expect(state.adjacentArticleIds()).toEqual({ prevId: null, nextId: null });
});
