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

import { getFeedUnreadCounts, listFeeds } from '../../../src/web/api/feed';
import {
  adjustFeedUnread,
  allUnreadCount,
  clearUnread,
  countsSnapshot,
  feedUnreadCount,
  folderUnreadCount,
  reloadCounts,
  restoreCounts,
} from '../../../src/web/feed/counts';
import { loadFeeds } from '../../../src/web/feed/list';
import { feedFixture } from './support';

/** The unread counts: per feed, the total and per folder (FD-COUNT, LIB-COUNT). */

const counts = (rows: ReadonlyArray<[string, number]>) =>
  ({
    items: rows.map(([feedId, count]) => ({ feedId, count })),
  }) as never;

const feeds = (items: ReadonlyArray<ReturnType<typeof feedFixture>>) =>
  ({ items }) as never;

const setup = async (
  rows: ReadonlyArray<[string, number]>,
  feedItems: ReadonlyArray<ReturnType<typeof feedFixture>>
) => {
  vi.mocked(listFeeds).mockResolvedValue(feeds(feedItems));
  vi.mocked(getFeedUnreadCounts).mockResolvedValue(counts(rows));
  await loadFeeds();
  await reloadCounts();
};

beforeEach(async () => {
  vi.mocked(getFeedUnreadCounts).mockReset();
  vi.mocked(listFeeds).mockReset();
  await setup([], []);
});

describe('FD-COUNT-1 a feed without a row counts as zero', () => {
  it('reads an absent feed as 0 and a listed feed as its row', async () => {
    await setup(
      [['feed-a', 3]],
      [feedFixture('feed-a', 'Go Blog'), feedFixture('feed-b', 'Rust Blog')]
    );

    expect(feedUnreadCount('feed-a')).toBe(3);
    expect(feedUnreadCount('feed-b')).toBe(0);
    expect(feedUnreadCount('unknown')).toBe(0);
  });
});

describe('FD-COUNT-2 the total is the sum over the feeds', () => {
  it('adds every feed count, including feeds in folders', async () => {
    await setup(
      [
        ['feed-a', 3],
        ['feed-b', 2],
        ['feed-c', 4],
      ],
      [feedFixture('feed-a', 'Go Blog', 'folder-tech')]
    );

    expect(allUnreadCount()).toBe(9);
  });
});

describe('FD-COUNT-3 a folder counts the feeds that are in it now', () => {
  it('sums only the counts of its own feeds', async () => {
    await setup(
      [
        ['feed-a', 3],
        ['feed-b', 2],
        ['feed-c', 4],
      ],
      [
        feedFixture('feed-a', 'Go Blog', 'folder-tech'),
        feedFixture('feed-b', 'Rust Blog', 'folder-tech'),
        feedFixture('feed-c', 'BBC', 'folder-news'),
        feedFixture('feed-d', 'Zeta Daily'),
      ]
    );

    expect(folderUnreadCount('folder-tech')).toBe(5);
    expect(folderUnreadCount('folder-news')).toBe(4);
    expect(folderUnreadCount('folder-empty')).toBe(0);
  });

  it('follows a feed to its new folder after a move', async () => {
    await setup(
      [
        ['feed-a', 3],
        ['feed-b', 2],
      ],
      [
        feedFixture('feed-a', 'Go Blog', 'folder-tech'),
        feedFixture('feed-b', 'Rust Blog', 'folder-tech'),
      ]
    );

    vi.mocked(listFeeds).mockResolvedValue(
      feeds([
        feedFixture('feed-a', 'Go Blog', 'folder-news'),
        feedFixture('feed-b', 'Rust Blog', 'folder-tech'),
      ])
    );
    await loadFeeds();

    expect(folderUnreadCount('folder-tech')).toBe(2);
    expect(folderUnreadCount('folder-news')).toBe(3);
  });
});

describe('LIB-COUNT-2 a count moves with each mark', () => {
  it('drops by one and rises by one', async () => {
    await setup([['feed-a', 3]], [feedFixture('feed-a', 'Go Blog')]);

    adjustFeedUnread('feed-a', -1);
    expect(feedUnreadCount('feed-a')).toBe(2);
    expect(allUnreadCount()).toBe(2);

    adjustFeedUnread('feed-a', 1);
    expect(feedUnreadCount('feed-a')).toBe(3);
  });

  it('never goes below zero', async () => {
    await setup([], [feedFixture('feed-a', 'Go Blog')]);

    adjustFeedUnread('feed-a', -1);

    expect(feedUnreadCount('feed-a')).toBe(0);
    expect(allUnreadCount()).toBe(0);
  });

  it('keeps the last known counts when reading them again fails', async () => {
    await setup([['feed-a', 5]], [feedFixture('feed-a', 'Go Blog')]);
    vi.mocked(getFeedUnreadCounts).mockRejectedValue(new Error('down'));

    await reloadCounts();

    expect(feedUnreadCount('feed-a')).toBe(5);
  });
});

describe('LIB-READ-4/6 clearing and rolling back the counts', () => {
  it('clears the given feeds and leaves the others', async () => {
    await setup(
      [
        ['feed-a', 3],
        ['feed-b', 2],
      ],
      [feedFixture('feed-a', 'Go Blog'), feedFixture('feed-b', 'Rust Blog')]
    );

    clearUnread(['feed-a']);

    expect(feedUnreadCount('feed-a')).toBe(0);
    expect(feedUnreadCount('feed-b')).toBe(2);
    expect(allUnreadCount()).toBe(2);
  });

  it('restores a snapshot taken before a mark', async () => {
    await setup(
      [
        ['feed-a', 3],
        ['feed-b', 2],
      ],
      [feedFixture('feed-a', 'Go Blog'), feedFixture('feed-b', 'Rust Blog')]
    );
    const snapshot = countsSnapshot();

    clearUnread(['feed-a', 'feed-b']);
    expect(allUnreadCount()).toBe(0);

    restoreCounts(snapshot);
    expect(feedUnreadCount('feed-a')).toBe(3);
    expect(allUnreadCount()).toBe(5);
  });
});
