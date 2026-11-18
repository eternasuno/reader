import { describe, expect, it } from 'vitest';
import {
  feedItemsOf,
  loaded,
  markAllInScope,
  markLoadedRead,
  mocks,
  rows,
  seedFeedItems,
  seedSavedPages,
  stores,
} from './read-support';
import { failure, feedItem, savedPage } from './support';

/** Marking the loaded rows (LIB-READ-3) and the whole scope (LIB-READ-4…6). */

const forty = Array.from({ length: 40 }, (_, index) =>
  savedPage({ id: `p${index}`, read: index >= 12 })
);

describe('marking the loaded rows', () => {
  it('Scenario: The loaded rows are marked in one request', async () => {
    stores.savedPages = 12;
    await seedSavedPages(forty);

    await markLoadedRead();

    expect(mocks.markSavedPages).toHaveBeenCalledTimes(1);
    expect(mocks.markSavedPages.mock.calls[0]?.[0]).toHaveLength(12);
    expect(rows().every((row) => row.item.read)).toBe(true);
    expect(stores.savedPages).toBe(0);
  });

  it('LIB-READ-3 sends an empty list when no loaded row is unread', async () => {
    await seedSavedPages([savedPage({ id: 'p1', read: true })]);

    await markLoadedRead();

    expect(mocks.markSavedPages).toHaveBeenCalledWith([]);
  });

  it('FD-MOVE-4 marks only the folder\u2019s current feeds', async () => {
    await seedFeedItems(
      [
        feedItem({ id: 'i2', feedId: 'feed-1' }),
        feedItem({ id: 'i1', feedId: 'feed-2' }),
      ],
      { kind: 'folder', id: 'folder-1' }
    );

    await markLoadedRead();

    expect(mocks.markFeedItems).toHaveBeenCalledWith(['i2']);
    expect(loaded('i1').item.read).toBe(false);
  });

  it('LIB-READ-3 restores the rows and the counts on failure', async () => {
    stores.feedCounts.set('feed-1', 2);
    mocks.markFeedItems.mockRejectedValueOnce(
      failure('FeedItemRepositoryError')
    );
    await seedFeedItems(feedItemsOf(2, 2, 'feed-1'), {
      kind: 'feed',
      id: 'feed-1',
    });

    await markLoadedRead();

    expect(rows().every((row) => !row.item.read)).toBe(true);
    expect(stores.feedCounts.get('feed-1')).toBe(2);
    expect(mocks.showToast).toHaveBeenCalledWith(
      '暂时无法访问订阅文章，请稍后重试',
      'error'
    );
  });
});

describe('marking the whole scope', () => {
  it('Scenario: The whole scope is marked, including rows not loaded', async () => {
    stores.savedPages = 40;
    await seedSavedPages(forty.slice(0, 30));

    await markAllInScope({ kind: 'later' });

    expect(mocks.markAllSavedPages).toHaveBeenCalledTimes(1);
    expect(rows().every((row) => row.item.read)).toBe(true);
    expect(stores.savedPages).toBe(0);
  });

  it('Scenario: A stale counter does not block marking the whole scope', async () => {
    await seedSavedPages([savedPage({ id: 'p1' })]);
    stores.savedPages = 0;

    await markAllInScope({ kind: 'later' });

    expect(mocks.markAllSavedPages).toHaveBeenCalledTimes(1);
    expect(loaded('p1').item.read).toBe(true);
  });
});

describe('a failed mark-all', () => {
  it('Scenario: A failed mark-all rolls back', async () => {
    stores.feedCounts.set('feed-1', 9);
    mocks.markFeedRead.mockRejectedValueOnce(
      failure('FeedItemRepositoryError')
    );
    await seedFeedItems(feedItemsOf(5, 5, 'feed-1'), {
      kind: 'feed',
      id: 'feed-1',
    });

    await markAllInScope({ kind: 'feed', id: 'feed-1' });

    expect(rows().every((row) => !row.item.read)).toBe(true);
    expect(stores.feedCounts.get('feed-1')).toBe(9);
    expect(mocks.reloadCounts).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it('FD-MOVE-4 leaves a moved-out feed\u2019s rows unread', async () => {
    stores.feedCounts.set('feed-1', 1);
    stores.feedCounts.set('feed-2', 1);
    await seedFeedItems(
      [
        feedItem({ id: 'i2', feedId: 'feed-1' }),
        feedItem({ id: 'i1', feedId: 'feed-2' }),
      ],
      { kind: 'folder', id: 'folder-1' }
    );

    await markAllInScope({ kind: 'folder', id: 'folder-1' });

    expect(mocks.markFolderRead).toHaveBeenCalledWith('folder-1');
    expect(loaded('i2').item.read).toBe(true);
    expect(loaded('i1').item.read).toBe(false);
    expect(stores.feedCounts.get('feed-1')).toBe(0);
    expect(stores.feedCounts.get('feed-2')).toBe(1);
  });

  it('Scenario: Marking another scope read from the sidebar', async () => {
    stores.savedPages = 4;
    stores.feedCounts.set('feed-1', 2);
    stores.feedCounts.set('feed-2', 3);
    await seedSavedPages([savedPage({ id: 'p1' })]);

    await markAllInScope({ kind: 'all' });

    expect(mocks.markAllFeedItems).toHaveBeenCalledTimes(1);
    expect(stores.savedPages).toBe(4);
    expect(stores.feedCounts.get('feed-1')).toBe(0);
    expect(stores.feedCounts.get('feed-2')).toBe(0);
  });
});
