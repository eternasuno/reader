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
import { feedGroups } from '../../../src/web/feed/grouping';
import { loadFeeds } from '../../../src/web/feed/list';
import { loadFolders } from '../../../src/web/folder/list';
import { feedFixture, folderFixture } from './support';

/**
 * The `订阅源` grouping: folders first, under each its feeds, then the top-level
 * feeds, each in the server's order (folders.md Interface).
 */

const setup = async () => {
  // The server's order: folders by name, feeds by title (FD-FOLDER-8, FD-LIST-3).
  const folders = [
    folderFixture('folder-empty', 'Empty'),
    folderFixture('folder-news', 'News'),
    folderFixture('folder-tech', 'Tech'),
  ];
  const feeds = [
    feedFixture('feed-alpha', 'Alpha Weekly'),
    feedFixture('feed-bbc', 'BBC', 'folder-news'),
    feedFixture('feed-go', 'Go Blog', 'folder-tech'),
    feedFixture('feed-rust', 'Rust Blog', 'folder-tech'),
    feedFixture('feed-zeta', 'Zeta Daily'),
  ];
  vi.mocked(listFolders).mockResolvedValue({ items: folders } as never);
  vi.mocked(listFeeds).mockResolvedValue({ items: feeds } as never);

  await Promise.all([loadFolders(), loadFeeds()]);
};

const titles = (items: ReadonlyArray<{ readonly title: string }>) =>
  items.map((item) => item.title);

beforeEach(async () => {
  await setup();
});

describe('Scenario: Folders come first ordered by name, and feeds without a folder follow ordered by title', () => {
  it('lists each folder with its feeds in the server order', () => {
    const { groups } = feedGroups();

    expect(groups.map((group) => group.folder.name)).toEqual([
      'Empty',
      'News',
      'Tech',
    ]);
    expect(groups[0]?.feeds).toHaveLength(0);
    expect(titles(groups[1]?.feeds ?? [])).toEqual(['BBC']);
    expect(titles(groups[2]?.feeds ?? [])).toEqual(['Go Blog', 'Rust Blog']);
  });

  it('lists the feeds of no folder after the folders, never re-sorted', () => {
    expect(titles(feedGroups().topLevel)).toEqual([
      'Alpha Weekly',
      'Zeta Daily',
    ]);
  });

  it('keeps an empty folder and shows a feed of an unknown folder at the top level', async () => {
    vi.mocked(listFeeds).mockResolvedValue({
      items: [
        feedFixture('feed-go', 'Go Blog', 'folder-tech'),
        feedFixture('feed-gone', 'Gone Blog', 'folder-missing'),
      ],
    } as never);
    await loadFeeds();

    expect(titles(feedGroups().topLevel)).toEqual(['Gone Blog']);
    expect(
      feedGroups().groups.find((group) => group.folder.name === 'Tech')
    ).toBeDefined();
  });
});
