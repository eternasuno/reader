import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/web/api/feed', () => ({
  listFeeds: vi.fn(),
  getFeedUnreadCounts: vi.fn(),
  previewFeed: vi.fn(),
  subscribeFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  moveFeed: vi.fn(),
  markFeedRead: vi.fn(),
  listFeedItemsOfFeed: vi.fn(),
}));
vi.mock('../../../src/web/api/folder', () => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  removeFolder: vi.fn(),
  markFolderRead: vi.fn(),
  listFolderItems: vi.fn(),
}));
vi.mock('../../../src/web/ui/toast', () => ({
  showToast: vi.fn(),
  toasts: () => [],
  dismissToast: vi.fn(),
  ToastContainer: () => null,
}));
vi.mock('../../../src/web/library', () => ({
  currentScope: vi.fn(() => ({ kind: 'later' })),
  selectScope: vi.fn(),
  ScopeRow: () => null,
}));

import { ApiFailure } from '../../../src/web/api/failure';
import { getFeedUnreadCounts, listFeeds } from '../../../src/web/api/feed';
import { listFolders } from '../../../src/web/api/folder';
import { allUnreadCount, feedUnreadCount } from '../../../src/web/feed/counts';
import { feeds } from '../../../src/web/feed/list';
import { loadSidebar } from '../../../src/web/feed/sidebar';
import { folders } from '../../../src/web/folder/list';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture, folderFixture } from './support';

/**
 * The sidebar load: feeds, folders and counts together; a failing request keeps
 * the last values and shows one toast until a load succeeds (library.md API).
 */

const feedRows = (items: ReadonlyArray<ReturnType<typeof feedFixture>>) =>
  ({ items }) as never;

const folderRows = (items: ReadonlyArray<ReturnType<typeof folderFixture>>) =>
  ({ items }) as never;

const countRows = (rows: ReadonlyArray<[string, number]>) =>
  ({ items: rows.map(([feedId, count]) => ({ feedId, count })) }) as never;

const serverHas = (
  feedItems: ReadonlyArray<ReturnType<typeof feedFixture>>,
  folderItems: ReadonlyArray<ReturnType<typeof folderFixture>>,
  rows: ReadonlyArray<[string, number]>
) => {
  vi.mocked(listFeeds).mockResolvedValue(feedRows(feedItems));
  vi.mocked(listFolders).mockResolvedValue(folderRows(folderItems));
  vi.mocked(getFeedUnreadCounts).mockResolvedValue(countRows(rows));
};

const serverDown = () => {
  vi.mocked(listFeeds).mockRejectedValue(new ApiFailure('FeedRepositoryError'));
  vi.mocked(listFolders).mockRejectedValue(
    new ApiFailure('FolderRepositoryError')
  );
  vi.mocked(getFeedUnreadCounts).mockRejectedValue(
    new ApiFailure('FeedItemRepositoryError')
  );
};

beforeEach(() => {
  vi.mocked(showToast).mockClear();
  serverHas([], [], []);
});

describe('the sidebar load fills feeds, folders and counts', () => {
  it('keeps the server order of feeds and folders (FD-LIST-3, FD-FOLDER-8)', async () => {
    serverHas(
      [feedFixture('feed-b', 'Rust Blog'), feedFixture('feed-a', 'Go Blog')],
      [
        folderFixture('folder-empty', 'Empty'),
        folderFixture('folder-2', 'Tech'),
      ],
      [['feed-a', 3]]
    );

    await loadSidebar();

    expect(feeds().map((feed) => feed.title)).toEqual(['Rust Blog', 'Go Blog']);
    expect(folders().map((folder) => folder.name)).toEqual(['Empty', 'Tech']);
    expect(feedUnreadCount('feed-a')).toBe(3);
    expect(allUnreadCount()).toBe(3);
  });
});

describe('a failing sidebar load keeps the last values and toasts once', () => {
  it('shows one error toast for repeated failures, and one more after a success', async () => {
    serverHas([feedFixture('feed-a', 'Go Blog')], [], [['feed-a', 3]]);
    await loadSidebar();

    serverDown();
    await loadSidebar();
    await loadSidebar();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问订阅，请稍后重试',
      'error'
    );
    expect(feedUnreadCount('feed-a')).toBe(3);

    vi.mocked(listFeeds).mockResolvedValue(
      feedRows([feedFixture('feed-a', 'Go Blog')])
    );
    vi.mocked(listFolders).mockResolvedValue(folderRows([]));
    vi.mocked(getFeedUnreadCounts).mockResolvedValue(countRows([]));
    await loadSidebar();

    serverDown();
    await loadSidebar();

    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('keeps the feeds and folders it already had', async () => {
    serverHas(
      [feedFixture('feed-a', 'Go Blog')],
      [folderFixture('folder-1', 'Tech')],
      [['feed-a', 3]]
    );
    await loadSidebar();

    serverDown();
    await loadSidebar();

    expect(feeds()).toHaveLength(1);
    expect(folders()).toHaveLength(1);
  });
});
