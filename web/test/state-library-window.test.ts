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

it('services an uncached window requested synchronously after a cached window', async () => {
  const { state } = ctx;
  await loadLater();
  ctx.queue({ items: pages.slice(0, 21) });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.articleById(ids[0])).not.toBeNull());

  ctx.queue({ items: pages.slice(429) });
  state.requestWindow({ start: 0, end: 0 });
  state.requestWindow({ start: 449, end: 449 });

  await vi.waitFor(() => expect(ctx.fetchCount()).toBe(3));
  expect(requestedIds(2)).toEqual(ids.slice(429));
  await vi.waitFor(() => expect(state.articleById(ids[449])).not.toBeNull());
  expect(ctx.fetchCount()).toBe(3);
});

it('clears a window error when scrolling back to a fully cached range', async () => {
  const { state } = ctx;
  await loadLater();
  ctx.queue({ items: pages.slice(0, 21) });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.articleById(ids[0])).not.toBeNull());

  ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
  state.requestWindow({ start: 449, end: 449 });
  await vi.waitFor(() =>
    expect(state.windowError()).toBe('SavedPageRepositoryError')
  );

  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.windowError()).toBeNull());
  expect(ctx.fetchCount()).toBe(3);
});

it('evicts an idle unknown off-window record and drops its entry after an older GET releases', async () => {
  const { state } = ctx;
  const { entries } = await import('../src/state/read-sync-state');
  const { queueIdle } = await import('../src/state/read-sync');
  const items = Array.from({ length: 1001 }, (_, index) =>
    makeItem({ id: uuid(index + 1), feedId: uuid(2001) })
  );
  const first = items[0].id;
  const last = items[1000].id;
  ctx.queue(feedOrder(items, boundary));
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  for (let offset = 0; offset < 1000; offset += 200) {
    ctx.queue({ items: items.slice(offset, offset + 200) });
  }

  state.requestWindow({ start: 0, end: 979 });
  await vi.waitFor(() =>
    expect(state.articleById(items[999].id)).not.toBeNull()
  );

  const older = ctx.pending();
  state.requestWindow({ start: 1000, end: 1000 });
  expect(requestedIds(6)).toEqual([last]);
  ctx.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const recovery = ctx.pending();
  await expect(state.toggleArticleRead(first, true)).resolves.toBe(false);
  await vi.waitFor(() => expect(queueIdle()).toBe(true));
  expect(entries.get(first)).toHaveProperty('confirmed', undefined);
  expect(state.articleById(first)).not.toBeNull();

  older.resolve(jsonResponse({ items: [items[1000]] }));
  await vi.waitFor(() => expect(ctx.fetchCount()).toBe(9));
  expect(requestedIds(8)).toEqual(items.slice(980).map(({ id }) => id));
  expect(state.articleById(first)).toBeNull();
  expect(entries.has(first)).toBe(false);
  expect(state.rowIds()).toContain(first);
  recovery.resolve(jsonResponse({ items: items.slice(980) }));
  await state.retryLoad();
});

it('retries only missing window IDs and keeps cached records fresh', async () => {
  const { state } = ctx;
  await loadLater();
  ctx.queue({ items: pages.slice(0, 21) });
  state.requestWindow({ start: 0, end: 0 });
  await vi.waitFor(() => expect(state.articleById(ids[0])).not.toBeNull());

  ctx.queue({ items: pages.slice(429) });
  state.requestWindow({ start: 449, end: 449 });
  await vi.waitFor(() => expect(state.articleById(ids[449])).not.toBeNull());

  ctx.queue({ error: 'SavedPageRepositoryError' }, 500);
  state.requestWindow({ start: 0, end: 1 });
  await vi.waitFor(() =>
    expect(state.windowError()).toBe('SavedPageRepositoryError')
  );
  expect(requestedIds(3)).toEqual(ids.slice(21, 22));

  ctx.queue({ items: pages.slice(0, 22) });
  await state.retryLoad();
  expect(requestedIds(4)).toEqual(ids.slice(21, 22));
  expect(state.articleById(ids[21])).not.toBeNull();
  expect(state.windowError()).toBeNull();

  state.requestWindow({ start: 449, end: 449 });
  expect(ctx.fetchCount()).toBe(5);
});
