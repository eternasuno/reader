import { afterEach, beforeEach, vi } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  makePage,
  savedOrder,
  uuid,
} from './state-fixture';

export const ctx = createStateTestContext();
export const first = makePage({ id: uuid(1) });
export const second = makePage({ id: uuid(2) });
export const third = makePage({ id: uuid(3) });
export const initialBoundary = uuid(10);
export const liveBoundary = uuid(11);
export const later = { kind: 'later' } as const;
const folderId = uuid(20);
export const folder = { kind: 'folder', folderId } as const;
export const feed = makeFeed({ id: uuid(21), folderId });
export const feedItem = makeItem({ id: uuid(22), feedId: feed.id });
export let live: typeof import('../../src/state/library-live');
export let snapshot: typeof import('../../src/state/library-snapshot');
export let queueIdle: typeof import('../../src/state/read-sync').queueIdle;
export let unmountLive: () => void;
let unmountLibrary: () => void;
let stopSidebar: () => void;

export const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
};

export const becomeVisible = (): void => {
  setHidden(false);
  document.dispatchEvent(new Event('visibilitychange'));
};

export const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
  ctx.solid.flush();
};

const urls = (): Array<string> =>
  ctx.fetchMock.mock.calls.map(([url]) => String(url));

export const orderCalls = (): Array<string> =>
  urls().filter((url) => url.includes('/order'));

export const windowCalls = (): Array<string> =>
  urls().filter((url) => url.startsWith('/api/saved-pages?ids='));

export const readWindow = async (items: Array<typeof first>): Promise<void> => {
  ctx.queue({ items });
  ctx.state.requestWindow({ start: 0, end: items.length - 1 });
  await settle();
};

export const loadLater = async (unread = false): Promise<void> => {
  ctx.queue(savedOrder([second, first], initialBoundary));
  await ctx.state.loadScopeFirstPage(later, unread);
};

export const startLiveRequest = () => {
  const pending = ctx.pending();
  ctx.queueSidebar();
  becomeVisible();
  return pending;
};

export const mountLive = async (): Promise<void> => {
  const sidebar = await import('../../src/state/sidebar-refresh');
  stopSidebar = sidebar.mountSidebarRefresh();
  unmountLive = live.mountLiveList();
};

export const untrackLibrary = (): void => {
  unmountLibrary();
  unmountLibrary = () => {};
};

beforeEach(async () => {
  vi.useFakeTimers();
  setHidden(false);
  await ctx.reset();
  live = await import('../../src/state/library-live');
  snapshot = await import('../../src/state/library-snapshot');
  ({ queueIdle } = await import('../../src/state/read-sync'));
  unmountLibrary = ctx.state.trackLibraryMount();
  await mountLive();
});

afterEach(() => {
  unmountLive();
  unmountLibrary();
  stopSidebar();
  setHidden(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
