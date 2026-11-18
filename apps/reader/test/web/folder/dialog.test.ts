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
import {
  createFolder,
  listFolders,
  renameFolder,
} from '../../../src/web/api/folder';
import { loadFeeds } from '../../../src/web/feed/list';
import {
  closeFolderDialog,
  folderDialogFolder,
  folderDialogName,
  folderDialogOpen,
  folderDialogPending,
  openCreateFolder,
  openRenameFolder,
  setFolderDialogName,
  submitFolderName,
} from '../../../src/web/folder/dialog';
import { folders, loadFolders } from '../../../src/web/folder/list';
import { showToast } from '../../../src/web/ui/toast';
import { folderFixture } from '../feed/support';

/** The folder dialog: create and rename (folders.md Creating and renaming a folder). */

const tech = folderFixture('folder-tech', 'Tech');
const news = folderFixture('folder-news', 'News');

beforeEach(async () => {
  vi.mocked(listFeeds).mockReset();
  vi.mocked(listFeeds).mockResolvedValue({ items: [] } as never);
  vi.mocked(listFolders).mockReset();
  vi.mocked(listFolders).mockResolvedValue({ items: [news, tech] } as never);
  vi.mocked(createFolder).mockReset();
  vi.mocked(createFolder).mockResolvedValue({ item: tech } as never);
  vi.mocked(renameFolder).mockReset();
  vi.mocked(renameFolder).mockResolvedValue(undefined as never);
  vi.mocked(showToast).mockClear();
  closeFolderDialog();
  await Promise.all([loadFolders(), loadFeeds()]);
});

describe('Scenario: Creating a folder', () => {
  it('opens with an empty name and no folder to rename', () => {
    setFolderDialogName('left over');
    openCreateFolder();

    expect(folderDialogOpen()).toBe(true);
    expect(folderDialogFolder()).toBeUndefined();
    expect(folderDialogName()).toBe('');
  });

  it('creates the folder with the name as typed and lists the sidebar again', async () => {
    openCreateFolder();
    setFolderDialogName('  Design  ');
    vi.mocked(listFolders).mockResolvedValue({
      items: [folderFixture('folder-design', 'Design'), news, tech],
    } as never);

    await submitFolderName();

    expect(createFolder).toHaveBeenCalledWith('  Design  ');
    expect(showToast).toHaveBeenCalledWith('目录已创建');
    expect(folderDialogOpen()).toBe(false);
    expect(folders().map((folder) => folder.name)).toEqual([
      'Design',
      'News',
      'Tech',
    ]);
    expect(listFeeds).toHaveBeenCalledTimes(2);
  });

  it('reports the pending state while the request runs', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(createFolder).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)) as never
    );
    openCreateFolder();
    setFolderDialogName('Design');

    const running = submitFolderName();

    expect(folderDialogPending()).toBe(true);

    finish({ item: tech });
    await running;

    expect(folderDialogPending()).toBe(false);
  });
});

describe('Scenario: Renaming a folder', () => {
  it('opens prefilled with the current name', () => {
    openRenameFolder(tech);

    expect(folderDialogFolder()?.id).toBe('folder-tech');
    expect(folderDialogName()).toBe('Tech');
  });

  it('renames and toasts 目录已重命名', async () => {
    openRenameFolder(tech);
    setFolderDialogName('Engineering');

    await submitFolderName();

    expect(renameFolder).toHaveBeenCalledWith('folder-tech', 'Engineering');
    expect(showToast).toHaveBeenCalledWith('目录已重命名');
    expect(folderDialogOpen()).toBe(false);
  });
});

describe('Scenario: Submitting without changing the name', () => {
  it('closes the dialog and leaves the name unchanged', async () => {
    openRenameFolder(tech);

    await submitFolderName();

    expect(renameFolder).toHaveBeenCalledWith('folder-tech', 'Tech');
    expect(folderDialogOpen()).toBe(false);
  });
});

describe('Scenario: Invalid folder names', () => {
  it('keeps the dialog and the typed name with the wording of the error', async () => {
    vi.mocked(createFolder).mockRejectedValue(
      new ApiFailure('InvalidFolderName')
    );
    openCreateFolder();
    setFolderDialogName('   ');

    await submitFolderName();

    expect(showToast).toHaveBeenCalledWith('请输入目录名称', 'error');
    expect(folderDialogOpen()).toBe(true);
    expect(folderDialogName()).toBe('   ');
    expect(listFeeds).toHaveBeenCalledTimes(1);
  });

  it('reports a taken name and keeps the dialog open', async () => {
    vi.mocked(renameFolder).mockRejectedValue(
      new ApiFailure('FolderAlreadyExists')
    );
    openRenameFolder(tech);
    setFolderDialogName('News');

    await submitFolderName();

    expect(showToast).toHaveBeenCalledWith('该目录名称已存在', 'error');
    expect(folderDialogOpen()).toBe(true);
    expect(folderDialogName()).toBe('News');
  });
});
