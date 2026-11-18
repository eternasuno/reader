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
import { listFeeds } from '../../../src/web/api/feed';
import { listFolders, removeFolder } from '../../../src/web/api/folder';
import { loadFeeds } from '../../../src/web/feed/list';
import { folders, loadFolders } from '../../../src/web/folder/list';
import {
  confirmRemoveFolder,
  deleteFolderQuestion,
} from '../../../src/web/folder/menu';
import { currentScope, selectScope } from '../../../src/web/library';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture, folderFixture } from '../feed/support';

/** Deleting a folder: the confirmation wording, the removal and its scope rules. */

const empty = folderFixture('folder-empty', 'Empty');
const news = folderFixture('folder-news', 'News');
const tech = folderFixture('folder-tech', 'Tech');

const zeta = feedFixture('feed-zeta', 'Zeta Daily');

beforeEach(async () => {
  vi.mocked(listFolders).mockReset();
  vi.mocked(listFolders).mockResolvedValue({
    items: [empty, news, tech],
  } as never);
  vi.mocked(listFeeds).mockResolvedValue({
    items: [
      feedFixture('feed-bbc', 'BBC', 'folder-news'),
      feedFixture('feed-go', 'Go Blog', 'folder-tech'),
      feedFixture('feed-rust', 'Rust Blog', 'folder-tech'),
      zeta,
    ],
  } as never);
  vi.mocked(removeFolder).mockReset();
  vi.mocked(removeFolder).mockResolvedValue(undefined as never);
  vi.mocked(showToast).mockClear();
  vi.mocked(selectScope).mockClear();
  vi.mocked(currentScope).mockReturnValue({ kind: 'later' });
  globalThis.confirm = vi.fn(() => true);
  await Promise.all([loadFolders(), loadFeeds()]);
});

describe('Scenario: Confirming before deleting a folder', () => {
  it('names the folder and the number of feeds it unsubscribes', () => {
    expect(deleteFolderQuestion(tech, 2)).toBe(
      '删除目录「Tech」并取消订阅其中的 2 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。'
    );
    expect(deleteFolderQuestion(empty, 0)).toBe('删除目录「Empty」？');
  });

  it('asks with the folder and the count of the feeds that are in it now', () => {
    confirmRemoveFolder(tech);

    expect(globalThis.confirm).toHaveBeenCalledWith(
      '删除目录「Tech」并取消订阅其中的 2 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。'
    );
  });
});

describe('Scenario: Cancelling the deletion', () => {
  it('sends nothing and keeps the folder and its feeds', async () => {
    globalThis.confirm = vi.fn(() => false);

    confirmRemoveFolder(tech);

    expect(removeFolder).not.toHaveBeenCalled();
    expect(folders().map((folder) => folder.id)).toContain('folder-tech');
  });
});

describe('Scenario: Confirming the deletion of a folder', () => {
  it('deletes it, toasts and lists the sidebar again', async () => {
    vi.mocked(listFolders).mockResolvedValue({ items: [empty, news] } as never);

    confirmRemoveFolder(tech);

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('目录已删除')
    );
    expect(removeFolder).toHaveBeenCalledWith('folder-tech');
    expect(folders().map((folder) => folder.id)).toEqual([
      'folder-empty',
      'folder-news',
    ]);
    expect(listFolders).toHaveBeenCalledTimes(2);
  });
});

describe('folders.md: deleting a folder that holds the current scope returns to 全部订阅', () => {
  it('selects 全部订阅 when the deleted folder is the open scope', async () => {
    vi.mocked(currentScope).mockReturnValue({
      kind: 'folder',
      id: 'folder-tech',
    });

    confirmRemoveFolder(tech);

    await vi.waitFor(() =>
      expect(selectScope).toHaveBeenCalledWith({ kind: 'all' })
    );
  });

  it('selects 全部订阅 when the open scope is a feed that was in it', async () => {
    vi.mocked(currentScope).mockReturnValue({ kind: 'feed', id: 'feed-go' });

    confirmRemoveFolder(tech);

    await vi.waitFor(() =>
      expect(selectScope).toHaveBeenCalledWith({ kind: 'all' })
    );
  });
});

describe('Scenario: Deleting a folder unrelated to the current reading scope', () => {
  it('leaves the current scope selected', async () => {
    vi.mocked(currentScope).mockReturnValue({ kind: 'feed', id: 'feed-zeta' });

    confirmRemoveFolder(tech);

    await vi.waitFor(() => expect(removeFolder).toHaveBeenCalled());
    expect(selectScope).not.toHaveBeenCalled();
  });
});

describe('Scenario: The deletion fails', () => {
  it('keeps the folder, its feeds and their articles and shows the error', async () => {
    vi.mocked(removeFolder).mockRejectedValue(
      new ApiFailure('FolderRepositoryError')
    );
    vi.mocked(currentScope).mockReturnValue({
      kind: 'folder',
      id: 'folder-tech',
    });

    confirmRemoveFolder(tech);

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        '暂时无法访问目录，请稍后重试',
        'error'
      )
    );
    expect(folders().map((folder) => folder.id)).toContain('folder-tech');
    expect(showToast).not.toHaveBeenCalledWith('目录已删除');
    expect(selectScope).not.toHaveBeenCalled();
    expect(listFolders).toHaveBeenCalledTimes(1);
  });
});
