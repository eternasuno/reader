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

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};
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
const queueSidebar = (
  options: {
    feeds?: Array<Feed>;
    folders?: Array<Folder>;
    counts?: Array<FeedUnreadCount>;
    saved?: number;
  } = {}
): void => {
  queue({ items: options.feeds ?? [] });
  queue({ items: options.folders ?? [] });
  queue({ items: options.counts ?? [] });
  queue({ count: options.saved ?? 0 });
};

describe('sidebar loading', () => {
  it('loads feeds, folders and unread counts in parallel', async () => {
    queueSidebar({
      feeds: [
        makeFeed({ id: 'f1', title: 'Go Blog', folderId: 'd1' }),
        makeFeed({ id: 'f2', title: 'Rust Blog', folderId: 'd1' }),
        makeFeed({ id: 'f3', title: 'Top', folderId: null }),
      ],
      folders: [makeFolder('d1')],
      counts: [
        { feedId: 'f1', count: 3 },
        { feedId: 'f2', count: 2 },
        { feedId: 'f3', count: 5 },
      ],
      saved: 4,
    });

    await state.refreshSidebar();
    solid.flush();

    expect(state.feeds()).toHaveLength(3);
    expect(state.folders()).toHaveLength(1);
    expect(state.savedUnreadCount()).toBe(4);
    expect(state.feedUnreadCount('f1')).toBe(3);
    expect(state.feedUnreadCount('missing')).toBe(0);
    expect(state.folderUnreadCount('d1')).toBe(5);
    expect(state.allFeedsUnreadCount()).toBe(10);
    expect(state.folderFeeds('d1').map((feed) => feed.id)).toEqual([
      'f1',
      'f2',
    ]);
    expect(state.topLevelFeeds().map((feed) => feed.id)).toEqual(['f3']);
  });
});

describe('sidebar failures', () => {
  it('keeps previous data when a sidebar request fails', async () => {
    queueSidebar({ feeds: [makeFeed({ id: 'f1' })], saved: 2 });
    await state.refreshSidebar();
    solid.flush();

    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('offline'))
    );
    await state.refreshSidebar();
    solid.flush();

    expect(state.feeds()).toHaveLength(1);
    expect(state.savedUnreadCount()).toBe(2);
  });
});

describe('folder collapse persistence', () => {
  it('persists folder collapse state', async () => {
    await state.refreshSidebar();
    solid.flush();

    state.toggleFolderCollapse('d1');
    solid.flush();
    expect(state.collapsedFolders().has('d1')).toBe(true);
    expect(localStorage.getItem(state.COLLAPSED_FOLDERS_STORAGE_KEY)).toBe(
      '["d1"]'
    );

    state.expandFolder('d1');
    solid.flush();
    expect(state.collapsedFolders().has('d1')).toBe(false);
    expect(localStorage.getItem(state.COLLAPSED_FOLDERS_STORAGE_KEY)).toBe(
      '[]'
    );

    state.expandFolder('missing');
    solid.flush();
    expect(localStorage.getItem(state.COLLAPSED_FOLDERS_STORAGE_KEY)).toBe(
      '[]'
    );
  });
});

describe('folder collapse restore', () => {
  it('restores collapsed folders from localStorage on startup', async () => {
    localStorage.setItem(
      state.COLLAPSED_FOLDERS_STORAGE_KEY,
      JSON.stringify(['d1', 7])
    );
    await fresh();

    expect([...state.collapsedFolders()]).toEqual(['d1']);
  });
});
