import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Feed, FeedItem, SavedPage } from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;
let releaseMount: () => void = () => {};

const unmountLibrary = (): void => {
  releaseMount();
  releaseMount = () => {};
};

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  vi.resetModules();
  solid = await import('solid-js');
  state = await import('../src/state');
  releaseMount = state.trackLibraryMount();
});

afterEach(() => {
  unmountLibrary();
  vi.useRealTimers();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};

const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};

const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const fetchCount = (): number => fetchMock.mock.calls.length;

const feedListCalls = (since = 0): number =>
  fetchMock.mock.calls
    .slice(since)
    .filter(([url]) => String(url) === '/api/feeds').length;

const makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});

const refreshedFeed = (id: string): Feed =>
  makeFeed({ id, updatedAt: '2026-11-19T00:00:00Z' });

const makeItem = (
  overrides: Partial<FeedItem> & { id: string; feedId: string }
): FeedItem => ({
  url: `https://example.com/${overrides.id}`,
  title: `Item ${overrides.id}`,
  description: '<p>summary</p>',
  content: '<p>content</p>',
  read: false,
  ...overrides,
});

const queueSidebar = (feeds: Array<Feed> = []): void => {
  queue({ items: feeds });
  queue({ items: [] });
  queue({ items: [] });
  queue({ count: 0 });
};

const openEmptyScope = async (
  scope: Parameters<StateModule['loadScopeFirstPage']>[0],
  unread = false
): Promise<number> => {
  queue({ items: [] as Array<SavedPage | FeedItem>, cursor: null });
  await state.loadScopeFirstPage(scope, unread);
  solid.flush();
  return fetchCount();
};

const queueEmptyFeed = async (feedId: string): Promise<number> => {
  queueSidebar([makeFeed({ id: feedId })]);
  await state.refreshSidebar();
  solid.flush();
  return openEmptyScope({ kind: 'feed', feedId });
};

const queueReloadResponses = (feed: Feed, items: Array<FeedItem>): void => {
  queueSidebar([feed]);
  queue({ items, cursor: null });
};

const queueRefreshedReload = (feedId: string, itemId: string): Feed => {
  const refreshed = refreshedFeed(feedId);
  queue({ items: [refreshed] });
  queueReloadResponses(refreshed, [makeItem({ id: itemId, feedId })]);
  return refreshed;
};

const startWait = (feedId = 'f1') => {
  const controller = new AbortController();
  const poll = state.reloadAfterFirstRefresh(feedId, controller.signal);
  let done = false;
  void poll.then(() => {
    done = true;
  });
  return { controller, poll, isDone: () => done };
};

const expectReloaded = (
  listIndex: number,
  feedId: string,
  itemId: string,
  unread = false
): void => {
  expect(requestUrl(listIndex)).toBe(
    `/api/feeds/${feedId}/items?limit=30&unread=${unread}`
  );
  expect(state.rows().map((row) => row.id)).toEqual([itemId]);
};

const expectStopped = (expectedFetches: number): void => {
  expect(fetchCount()).toBe(expectedFetches);
  expect(state.rows()).toHaveLength(0);
};

const startInFlightPoll = async (itemId: string) => {
  const before = await queueEmptyFeed('f1');
  const listRequest = pending();
  const refreshed = refreshedFeed('f1');
  queueReloadResponses(refreshed, [makeItem({ id: itemId, feedId: 'f1' })]);
  const { controller, poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);
  expect(requestUrl(before)).toBe('/api/feeds');
  const finish = async () => {
    listRequest.resolve(json({ items: [refreshed] }));
    await poll;
    solid.flush();
    expectStopped(before + 1);
  };
  return { controller, finish };
};

it('reloads the feed list once the feed finishes refreshing on the 2nd poll', async () => {
  const before = await queueEmptyFeed('f1');
  queue({ items: [makeFeed({ id: 'f1' })] });
  queueRefreshedReload('f1', 'i1');

  const { poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expect(requestUrl(before + 1)).toBe('/api/feeds');
  expectReloaded(before + 6, 'f1', 'i1');
});

it('retries after a failed feedsApi.list request and reloads when the next succeeds', async () => {
  const before = await queueEmptyFeed('f1');
  fetchMock.mockRejectedValueOnce(new Error('network error'));
  queueRefreshedReload('f1', 'i2');

  const { poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expect(requestUrl(before + 1)).toBe('/api/feeds');
  expectReloaded(before + 6, 'f1', 'i2');
});

it('stops without further polling or reloading when aborted before the next tick', async () => {
  const before = await queueEmptyFeed('f1');
  queue({ items: [makeFeed({ id: 'f1' })] });
  queueRefreshedReload('f1', 'i3');

  const { controller, poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);

  controller.abort();
  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expectStopped(before + 1);
});

it('stops without reloading when aborted while feedsApi.list is in flight', async () => {
  const { controller, finish } = await startInFlightPoll('i4');
  controller.abort();
  await finish();
});

it('stops without reloading when aborted while refreshSidebar is in flight', async () => {
  const before = await queueEmptyFeed('f1');
  const refreshed = refreshedFeed('f1');
  queue({ items: [refreshed] });
  const sidebarRequest = pending();
  queue({ items: [] });
  queue({ items: [] });
  queue({ count: 0 });
  queue({ items: [makeItem({ id: 'i5', feedId: 'f1' })], cursor: null });

  const { controller, poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 5);

  controller.abort();
  sidebarRequest.resolve(json({ items: [refreshed] }));
  await poll;
  solid.flush();
  expectStopped(before + 5);
});

it('stops without reloading when a successful list does not contain the feed', async () => {
  const before = await queueEmptyFeed('f1');
  queue({ items: [makeFeed({ id: 'other' })] });
  queueRefreshedReload('f1', 'i6');

  const { poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  await vi.advanceTimersByTimeAsync(2000);
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expectStopped(before + 1);
});

it('stops without polling /api/feeds when the library unmounts before the tick', async () => {
  const before = await queueEmptyFeed('f1');
  queueRefreshedReload('f1', 'i7');

  const { isDone } = startWait('f1');
  unmountLibrary();

  await vi.advanceTimersByTimeAsync(4000);
  solid.flush();

  expect(isDone()).toBe(true);
  expect(feedListCalls(before)).toBe(0);
  expectStopped(before);
});

it('stops without refreshing sidebar or reloading when unmounted while /api/feeds is in flight', async () => {
  const { finish } = await startInFlightPoll('i11');
  unmountLibrary();
  await finish();
});

it('skips ticks on another scope and polls once the empty feed opens', async () => {
  queueSidebar([makeFeed({ id: 'f1' })]);
  await state.refreshSidebar();
  const beforeLater = await openEmptyScope({ kind: 'later' });

  const { poll, isDone } = startWait('f1');
  await vi.advanceTimersByTimeAsync(4000);
  expect(isDone()).toBe(false);
  expect(feedListCalls(beforeLater)).toBe(0);

  const afterOpen = await openEmptyScope({ kind: 'feed', feedId: 'f1' });
  queueRefreshedReload('f1', 'i8');

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(feedListCalls(afterOpen)).toBe(2);
  expect(requestUrl(afterOpen)).toBe('/api/feeds');
  expectReloaded(afterOpen + 5, 'f1', 'i8');
});

it('stops polling once another scope opens after the feed was viewed', async () => {
  const before = await queueEmptyFeed('f1');
  queue({ items: [makeFeed({ id: 'f1' })] });

  const { isDone } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(before)).toBe(1);

  const afterLeave = await openEmptyScope({ kind: 'later' });
  queueRefreshedReload('f1', 'i9');

  await vi.advanceTimersByTimeAsync(4000);
  solid.flush();

  expect(isDone()).toBe(true);
  expect(feedListCalls(afterLeave)).toBe(0);
  expectStopped(afterLeave);
});

it('keeps polling after toggling unread on the same feed and reloads when refreshed', async () => {
  const before = await queueEmptyFeed('f1');
  queue({ items: [makeFeed({ id: 'f1' })] });

  const { poll } = startWait('f1');
  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(before)).toBe(1);

  const afterToggle = await openEmptyScope(
    { kind: 'feed', feedId: 'f1' },
    true
  );
  queueRefreshedReload('f1', 'i10');

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(feedListCalls(afterToggle)).toBe(2);
  expect(requestUrl(afterToggle)).toBe('/api/feeds');
  expectReloaded(afterToggle + 5, 'f1', 'i10', true);
});

it('aborts the earlier wait so only one poll stream runs', async () => {
  const beforeA = await queueEmptyFeed('fA');
  state.startFirstRefreshWait('fA');
  state.startFirstRefreshWait('fB');

  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(beforeA)).toBe(0);

  const afterOpenB = await openEmptyScope({ kind: 'feed', feedId: 'fB' });
  queue({ items: [makeFeed({ id: 'fB' })] });
  queueRefreshedReload('fB', 'iB');

  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(afterOpenB)).toBe(1);

  await vi.advanceTimersByTimeAsync(2000);
  await Promise.resolve();
  solid.flush();

  expect(feedListCalls(afterOpenB)).toBe(3);
  expectReloaded(afterOpenB + 6, 'fB', 'iB');
});
