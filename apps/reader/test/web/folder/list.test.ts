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
vi.mock('../../../src/web/library', () => ({
  currentScope: vi.fn(() => ({ kind: 'later' })),
  selectScope: vi.fn(),
  ScopeRow: () => null,
}));

import { listFeeds } from '../../../src/web/api/feed';
import { listFolders } from '../../../src/web/api/folder';
import { loadFeeds } from '../../../src/web/feed/list';
import {
  feedIdsInFolder,
  folderById,
  folders,
  loadFolders,
} from '../../../src/web/folder/list';
import { feedFixture, folderFixture } from '../feed/support';

/** The folder list and the feeds in a folder (FD-FOLDER-8, FD-LIST-6). */

const empty = folderFixture('folder-empty', 'Empty');
const news = folderFixture('folder-news', 'News');
const tech = folderFixture('folder-tech', 'Tech');

beforeEach(async () => {
  vi.mocked(listFolders).mockResolvedValue({
    items: [empty, news, tech],
  } as never);
  vi.mocked(listFeeds).mockResolvedValue({
    items: [
      feedFixture('feed-bbc', 'BBC', 'folder-news'),
      feedFixture('feed-go', 'Go Blog', 'folder-tech'),
      feedFixture('feed-rust', 'Rust Blog', 'folder-tech'),
      feedFixture('feed-zeta', 'Zeta Daily'),
    ],
  } as never);
  await Promise.all([loadFolders(), loadFeeds()]);
});

describe('FD-FOLDER-8 the list keeps the server order', () => {
  it('returns the folders as they came, empty ones included', () => {
    expect(folders().map((folder) => folder.name)).toEqual([
      'Empty',
      'News',
      'Tech',
    ]);
  });

  it('finds one folder by id', () => {
    expect(folderById('folder-tech')?.name).toBe('Tech');
    expect(folderById('folder-missing')).toBeUndefined();
  });

  it('rejects when the list cannot be read', async () => {
    vi.mocked(listFolders).mockRejectedValue(new Error('down'));

    await expect(loadFolders()).rejects.toThrow('down');
  });
});

describe('FD-LIST-6 a folder lists the feeds that are in it now', () => {
  it('returns the ids of its feed rows only', () => {
    expect(feedIdsInFolder('folder-tech')).toEqual(['feed-go', 'feed-rust']);
    expect(feedIdsInFolder('folder-news')).toEqual(['feed-bbc']);
    expect(feedIdsInFolder('folder-empty')).toEqual([]);
  });

  it('follows a feed that moved to another folder', async () => {
    vi.mocked(listFeeds).mockResolvedValue({
      items: [
        feedFixture('feed-bbc', 'BBC', 'folder-news'),
        feedFixture('feed-go', 'Go Blog', 'folder-news'),
        feedFixture('feed-rust', 'Rust Blog', 'folder-tech'),
      ],
    } as never);
    await loadFeeds();

    expect(feedIdsInFolder('folder-news')).toEqual(['feed-bbc', 'feed-go']);
    expect(feedIdsInFolder('folder-tech')).toEqual(['feed-rust']);
  });
});
