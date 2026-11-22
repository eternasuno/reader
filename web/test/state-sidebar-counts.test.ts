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

const queueFoldersOfFeeds = async (): Promise<void> => {
  queueSidebar({
    feeds: [
      makeFeed({ id: 'f1', folderId: 'd1' }),
      makeFeed({ id: 'f2', folderId: 'd1' }),
      makeFeed({ id: 'f3' }),
    ],
    counts: [
      { feedId: 'f1', count: 2 },
      { feedId: 'f2', count: 3 },
      { feedId: 'f3', count: 1 },
    ],
    saved: 2,
  });
  await state.refreshSidebar();
  solid.flush();
};

describe('unread count adjustments', () => {
  it('adjusts and clamps saved and feed unread counts', async () => {
    await queueFoldersOfFeeds();

    state.adjustSavedUnread(1);
    state.adjustFeedUnread('f1', -1);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(3);
    expect(state.feedUnreadCount('f1')).toBe(1);

    state.adjustSavedUnread(-10);
    state.adjustFeedUnread('f1', -10);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(0);
    expect(state.feedUnreadCount('f1')).toBe(0);

    state.setSavedUnread(5);
    state.adjustFeedUnread('f2', 2);
    state.adjustFeedUnread('f2', -1);
    solid.flush();
    expect(state.savedUnreadCount()).toBe(5);
    expect(state.feedUnreadCount('f2')).toBe(4);
  });
});

describe('unread count resets', () => {
  it('clears folder and all-feeds unread counts', async () => {
    await queueFoldersOfFeeds();

    state.clearFolderUnread('d1');
    solid.flush();
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.feedUnreadCount('f2')).toBe(0);
    expect(state.feedUnreadCount('f3')).toBe(1);

    state.clearAllFeedsUnread();
    solid.flush();
    expect(state.feedUnreadMap()).toEqual({});
  });
});

describe('local feed and folder edits', () => {
  it('updates, removes feeds and dissolves folders locally', async () => {
    queueSidebar({
      feeds: [
        makeFeed({ id: 'f1', folderId: 'd1' }),
        makeFeed({ id: 'f2', folderId: 'd1' }),
      ],
      folders: [makeFolder('d1')],
      counts: [
        { feedId: 'f1', count: 1 },
        { feedId: 'f2', count: 2 },
      ],
    });
    await state.refreshSidebar();
    solid.flush();

    state.updateFeedLocal('f1', { title: 'Renamed', readerMode: 'embedded' });
    solid.flush();
    expect(state.feeds()[0].title).toBe('Renamed');
    expect(state.feeds()[0].readerMode).toBe('embedded');

    state.removeFolderLocal('d1');
    solid.flush();
    expect(state.folders()).toHaveLength(0);
    expect(state.feeds().every((feed) => feed.folderId === null)).toBe(true);

    state.removeFeedLocal('f2');
    solid.flush();
    expect(state.feeds().map((feed) => feed.id)).toEqual(['f1']);
    expect(state.feedUnreadMap()).toEqual({ f1: 1 });
  });
});
