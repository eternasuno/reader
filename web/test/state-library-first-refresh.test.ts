import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Feed, FeedItem } from '../src/api';
import {
  feedOrder,
  jsonResponse as json,
  makeFeed,
  makeItem,
  uuid,
} from './support/state-fixture';

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

const refreshedFeed = (id: string): Feed =>
  makeFeed({ id, updatedAt: '2026-11-19T00:00:00Z' });

const B = '019363b8-0000-7000-8000-000000000001';
const queuePage = (items: Array<FeedItem> = []): void => {
  queue(feedOrder(items, B));
  if (items.length > 0) queue({ items });
};
const queueCounts = (): void => {
  queue({ items: [], boundary: B });
  queue({ count: 0, boundary: B });
};
const queueSidebar = (feeds: Array<Feed> = []): void => {
  queue({ items: feeds });
  queue({ items: [] });
  queueCounts();
};

const openEmptyScope = async (
  scope: Parameters<StateModule['loadScopeFirstPage']>[0],
  unread = false
): Promise<number> => {
  if (scope.kind === 'later') queue({ ids: [], boundary: B });
  else queuePage();
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
  queuePage(items);
};

const queueRefreshedReload = (feedId: string, itemId: string): Feed => {
  const refreshed = refreshedFeed(feedId);
  queue({ items: [refreshed] });
  queueReloadResponses(refreshed, [makeItem({ id: itemId, feedId })]);
  return refreshed;
};

const startWait = (feedId = uuid(1001)) => {
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
    `/api/feeds/${feedId}/items/order?unread=${unread}`
  );
  expect(state.rows().map((row) => row.id)).toEqual([itemId]);
};

const expectStopped = (expectedFetches: number): void => {
  expect(fetchCount()).toBe(expectedFetches);
  expect(state.rows()).toHaveLength(0);
};

const startInFlightPoll = async (itemId: string) => {
  const before = await queueEmptyFeed(uuid(1001));
  const listRequest = pending();
  const refreshed = refreshedFeed(uuid(1001));
  queueReloadResponses(refreshed, [
    makeItem({ id: itemId, feedId: uuid(1001) }),
  ]);
  const { controller, poll } = startWait(uuid(1001));
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
  const before = await queueEmptyFeed(uuid(1001));
  queue({ items: [makeFeed({ id: uuid(1001) })] });
  queueRefreshedReload(uuid(1001), uuid(1007));

  const { poll } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expect(requestUrl(before + 1)).toBe('/api/feeds');
  expectReloaded(before + 6, uuid(1001), uuid(1007));
});

it('retries after a failed feedsApi.list request and reloads when the next succeeds', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  fetchMock.mockRejectedValueOnce(new Error('network error'));
  queueRefreshedReload(uuid(1001), uuid(1008));

  const { poll } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 1);

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expect(requestUrl(before + 1)).toBe('/api/feeds');
  expectReloaded(before + 6, uuid(1001), uuid(1008));
});

it('stops without further polling or reloading when aborted before the next tick', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  queue({ items: [makeFeed({ id: uuid(1001) })] });
  queueRefreshedReload(uuid(1001), uuid(1009));

  const { controller, poll } = startWait(uuid(1001));
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
  const before = await queueEmptyFeed(uuid(1001));
  const refreshed = refreshedFeed(uuid(1001));
  queue({ items: [refreshed] });
  const sidebarRequest = pending();
  queue({ items: [] });
  queueCounts();
  queuePage([makeItem({ id: uuid(1010), feedId: uuid(1001) })]);

  const { controller, poll } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchCount()).toBe(before + 5);

  controller.abort();
  sidebarRequest.resolve(json({ items: [refreshed] }));
  await poll;
  solid.flush();
  expectStopped(before + 5);
});

it('stops without reloading when a successful list does not contain the feed', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  queue({ items: [makeFeed({ id: uuid(1016) })] });
  queueRefreshedReload(uuid(1001), 'i6');

  const { poll } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  await vi.advanceTimersByTimeAsync(2000);
  solid.flush();

  expect(requestUrl(before)).toBe('/api/feeds');
  expectStopped(before + 1);
});

it('stops without polling /api/feeds when the library unmounts before the tick', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  queueRefreshedReload(uuid(1001), 'i7');

  const { isDone } = startWait(uuid(1001));
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
  queueSidebar([makeFeed({ id: uuid(1001) })]);
  await state.refreshSidebar();
  const beforeLater = await openEmptyScope({ kind: 'later' });

  const { poll, isDone } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(4000);
  expect(isDone()).toBe(false);
  expect(feedListCalls(beforeLater)).toBe(0);

  const afterOpen = await openEmptyScope({ kind: 'feed', feedId: uuid(1001) });
  queueRefreshedReload(uuid(1001), uuid(1023));

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(feedListCalls(afterOpen)).toBe(2);
  expect(requestUrl(afterOpen)).toBe('/api/feeds');
  expectReloaded(afterOpen + 5, uuid(1001), uuid(1023));
});

it('stops polling once another scope opens after the feed was viewed', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  queue({ items: [makeFeed({ id: uuid(1001) })] });

  const { isDone } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(before)).toBe(1);

  const afterLeave = await openEmptyScope({ kind: 'later' });
  queueRefreshedReload(uuid(1001), 'i9');

  await vi.advanceTimersByTimeAsync(4000);
  solid.flush();

  expect(isDone()).toBe(true);
  expect(feedListCalls(afterLeave)).toBe(0);
  expectStopped(afterLeave);
});

it('keeps polling after toggling unread on the same feed and reloads when refreshed', async () => {
  const before = await queueEmptyFeed(uuid(1001));
  queue({ items: [makeFeed({ id: uuid(1001) })] });

  const { poll } = startWait(uuid(1001));
  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(before)).toBe(1);

  const afterToggle = await openEmptyScope(
    { kind: 'feed', feedId: uuid(1001) },
    true
  );
  queueRefreshedReload(uuid(1001), uuid(1024));

  await vi.advanceTimersByTimeAsync(2000);
  await poll;
  solid.flush();

  expect(feedListCalls(afterToggle)).toBe(2);
  expect(requestUrl(afterToggle)).toBe('/api/feeds');
  expectReloaded(afterToggle + 5, uuid(1001), uuid(1024), true);
});

it('aborts the earlier wait so only one poll stream runs', async () => {
  const beforeA = await queueEmptyFeed(uuid(1005));
  state.startFirstRefreshWait(uuid(1005));
  state.startFirstRefreshWait(uuid(1006));

  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(beforeA)).toBe(0);

  const afterOpenB = await openEmptyScope({ kind: 'feed', feedId: uuid(1006) });
  queue({ items: [makeFeed({ id: uuid(1006) })] });
  queueRefreshedReload(uuid(1006), uuid(1025));

  await vi.advanceTimersByTimeAsync(2000);
  expect(feedListCalls(afterOpenB)).toBe(1);

  await vi.advanceTimersByTimeAsync(2000);
  await Promise.resolve();
  solid.flush();

  expect(feedListCalls(afterOpenB)).toBe(3);
  expectReloaded(afterOpenB + 6, uuid(1006), uuid(1025));
});
