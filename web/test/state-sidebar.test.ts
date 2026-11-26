import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeFolder,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('sidebar loading', () => {
  it('loads feeds, folders and unread counts in parallel', async () => {
    const { state, solid } = ctx;
    ctx.queueSidebar({
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
  it('keeps previous data when a sidebar request fails and applies partial successes', async () => {
    const { state, solid, fetchMock } = ctx;
    ctx.queueSidebar({
      feeds: [makeFeed({ id: 'f1' })],
      folders: [makeFolder('d1')],
      saved: 2,
    });
    await state.refreshSidebar();
    solid.flush();

    fetchMock.mockImplementation(() =>
      Promise.reject(new TypeError('offline'))
    );
    await state.refreshSidebar();
    solid.flush();

    expect(state.feeds()).toHaveLength(1);
    expect(state.savedUnreadCount()).toBe(2);

    // Partial success: feeds + saved succeed, folders + counts fail.
    fetchMock.mockReset();
    ctx.queue({ items: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })] });
    fetchMock.mockRejectedValueOnce(new TypeError('folders failed'));
    fetchMock.mockRejectedValueOnce(new TypeError('counts failed'));
    ctx.queue({ count: 7, boundary: '019363b8-0000-7000-8000-000000000007' });
    await state.refreshSidebar();
    solid.flush();

    expect(state.feeds()).toHaveLength(2);
    expect(state.folders().map((folder) => folder.id)).toEqual(['d1']);
    expect(state.savedUnreadCount()).toBe(7);
  });
});

describe('folder collapse persistence', () => {
  it('persists folder collapse state', async () => {
    const { state, solid } = ctx;
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
      ctx.state.COLLAPSED_FOLDERS_STORAGE_KEY,
      JSON.stringify(['d1', 7])
    );
    await ctx.fresh();

    expect([...ctx.state.collapsedFolders()]).toEqual(['d1']);
  });
});
