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
import { listFeeds, moveFeed } from '../../../src/web/api/feed';
import { listFolders } from '../../../src/web/api/folder';
import { loadFeeds } from '../../../src/web/feed/list';
import { loadFolders } from '../../../src/web/folder/list';
import * as move from '../../../src/web/folder/move';
import {
  closeMoveFeed,
  moveFeedToFolder,
  moveTarget,
  movingFeed,
  openMoveFeed,
  setMoveTarget,
} from '../../../src/web/folder/move';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture, folderFixture } from '../feed/support';

/** Moving a feed into or out of a folder (FD-MOVE, folders.md Moving a feed). */

const goBlog = feedFixture('feed-go', 'Go Blog', 'folder-tech');
const zeta = feedFixture('feed-zeta', 'Zeta Daily');

beforeEach(async () => {
  vi.mocked(listFeeds).mockReset();
  vi.mocked(listFeeds).mockResolvedValue({
    items: [goBlog, zeta],
  } as never);
  vi.mocked(listFolders).mockResolvedValue({
    items: [
      folderFixture('folder-empty', 'Empty'),
      folderFixture('folder-news', 'News'),
      folderFixture('folder-tech', 'Tech'),
    ],
  } as never);
  vi.mocked(moveFeed).mockReset();
  vi.mocked(moveFeed).mockResolvedValue(undefined as never);
  vi.mocked(showToast).mockClear();
  closeMoveFeed();
  await Promise.all([loadFolders(), loadFeeds()]);
});

describe('Scenario: The move dialog preselects the current folder', () => {
  it('opens on the folder the feed is in', () => {
    openMoveFeed(goBlog);

    expect(movingFeed()?.id).toBe('feed-go');
    expect(moveTarget()).toBe('folder-tech');
  });

  it('opens on no folder for a top-level feed', () => {
    openMoveFeed(zeta);

    expect(moveTarget()).toBeUndefined();
  });
});

describe('Scenario: Confirming the original folder makes no change', () => {
  it('sends the move, which the server ignores, and closes the dialog', async () => {
    openMoveFeed(goBlog);

    await moveFeedToFolder();

    expect(moveFeed).toHaveBeenCalledWith('feed-go', 'folder-tech');
    expect(showToast).toHaveBeenCalledWith('已移动');
    expect(movingFeed()).toBeUndefined();
  });

  it('sends null for a top-level feed confirmed as it is (FD-MOVE-1)', async () => {
    openMoveFeed(zeta);

    await moveFeedToFolder();

    expect(moveFeed).toHaveBeenCalledWith('feed-zeta', null);
    expect(movingFeed()).toBeUndefined();
  });
});

describe('Scenario: Moving a feed that has no folder into a folder', () => {
  it('moves it, toasts 已移动 and lists the sidebar again', async () => {
    openMoveFeed(zeta);
    setMoveTarget('folder-news');
    vi.mocked(listFeeds).mockResolvedValue({
      items: [feedFixture('feed-go', 'Go Blog', 'folder-tech')],
    } as never);

    await moveFeedToFolder();

    expect(moveFeed).toHaveBeenCalledWith('feed-zeta', 'folder-news');
    expect(showToast).toHaveBeenCalledWith('已移动');
    expect(movingFeed()).toBeUndefined();
    expect(listFeeds).toHaveBeenCalledTimes(2);
  });
});

describe('Scenario: Moving a feed out of a folder', () => {
  it('sends null for the top level', async () => {
    openMoveFeed(goBlog);
    setMoveTarget(undefined);

    await moveFeedToFolder();

    expect(moveFeed).toHaveBeenCalledWith('feed-go', null);
  });
});

describe('Moving is a quick action (Client conventions)', () => {
  it('keeps no pending state', () => {
    expect(Object.keys(move)).not.toContain('movePending');
  });

  it('sends every submit while an earlier one is still in flight', async () => {
    const settling: Array<() => void> = [];

    vi.mocked(moveFeed).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settling.push(resolve);
        }) as never
    );
    openMoveFeed(zeta);
    setMoveTarget('folder-news');

    const first = moveFeedToFolder();
    const second = moveFeedToFolder();

    expect(moveFeed).toHaveBeenCalledTimes(2);
    expect(moveTarget()).toBe('folder-news');

    for (const settle of settling) settle();
    await Promise.all([first, second]);

    expect(movingFeed()).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('已移动');
  });
});

describe('Scenario: The move fails', () => {
  it('shows the error and keeps the dialog and the feed where it was', async () => {
    vi.mocked(moveFeed).mockRejectedValue(
      new ApiFailure('FolderNotFound', { id: 'folder-news' })
    );
    openMoveFeed(zeta);
    setMoveTarget('folder-news');

    await moveFeedToFolder();

    expect(showToast).toHaveBeenCalledWith('目录不存在，可能已被删除', 'error');
    expect(movingFeed()?.id).toBe('feed-zeta');
    expect(moveTarget()).toBe('folder-news');
    expect(listFeeds).toHaveBeenCalledTimes(1);
  });
});
