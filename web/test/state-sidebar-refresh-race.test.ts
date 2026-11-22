import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed, FeedUnreadCount, Folder } from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  state = await import('../src/state');
};

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  await fresh();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});

const makeFolder = (id: string, name = `Folder ${id}`): Folder => ({
  id,
  name,
});

interface SidebarSnapshotOptions {
  feeds?: Array<Feed>;
  folders?: Array<Folder>;
  counts?: Array<FeedUnreadCount>;
  saved?: number;
}

const queueDeferredResponse = (body: unknown): (() => void) => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  fetchMock.mockReturnValueOnce(promise);

  return () => {
    resolve(json(body));
  };
};

const queueDeferredSidebar = (
  options: SidebarSnapshotOptions = {}
): { resolve: () => void } => {
  const resolveFeeds = queueDeferredResponse({ items: options.feeds ?? [] });
  const resolveFolders = queueDeferredResponse({
    items: options.folders ?? [],
  });
  const resolveCounts = queueDeferredResponse({ items: options.counts ?? [] });
  const resolveSaved = queueDeferredResponse({ count: options.saved ?? 0 });

  return {
    resolve: () => {
      resolveFeeds();
      resolveFolders();
      resolveCounts();
      resolveSaved();
    },
  };
};

const feedsListCallCount = (): number =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/feeds').length;

describe('sidebar refresh race on feed removal', () => {
  it('re-fetches instead of restoring a feed removed while refresh is in flight', async () => {
    const staleRound = queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A' }), makeFeed({ id: 'B' })],
      counts: [
        { feedId: 'A', count: 3 },
        { feedId: 'B', count: 1 },
      ],
    });
    const freshRound = queueDeferredSidebar({
      feeds: [makeFeed({ id: 'B' })],
      counts: [{ feedId: 'B', count: 1 }],
    });

    const pending = state.refreshSidebar();
    state.removeFeedLocal('A');

    staleRound.resolve();
    await vi.waitFor(() => {
      expect(feedsListCallCount()).toBe(2);
    });
    expect(state.feeds().some((feed) => feed.id === 'A')).toBe(false);
    expect(state.feedUnreadCount('A')).toBe(0);

    freshRound.resolve();
    await pending;
    solid.flush();

    expect(state.feeds().map((feed) => feed.id)).toEqual(['B']);
    expect(state.feedUnreadCount('A')).toBe(0);
    expect(state.feedUnreadCount('B')).toBe(1);
    expect(feedsListCallCount()).toBe(2);
  });
});

describe('sidebar refresh race on folder removal', () => {
  it('re-fetches instead of restoring a folder removed while refresh is in flight', async () => {
    const staleRound = queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A', folderId: 'F1' })],
      folders: [makeFolder('F1')],
      counts: [{ feedId: 'A', count: 3 }],
    });
    const freshRound = queueDeferredSidebar({
      feeds: [makeFeed({ id: 'A', folderId: null })],
      folders: [],
      counts: [{ feedId: 'A', count: 3 }],
    });

    const pending = state.refreshSidebar();
    state.removeFolderLocal('F1');

    staleRound.resolve();
    await vi.waitFor(() => {
      expect(feedsListCallCount()).toBe(2);
    });
    expect(state.folders()).toEqual([]);

    freshRound.resolve();
    await pending;
    solid.flush();

    expect(state.folders()).toEqual([]);
    expect(state.folderFeeds('F1')).toEqual([]);
    expect(state.topLevelFeeds().map((feed) => feed.id)).toEqual(['A']);
    expect(state.feedUnreadCount('A')).toBe(3);
    expect(feedsListCallCount()).toBe(2);
  });
});
