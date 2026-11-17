import { describe, expect, it } from 'vitest';
import {
  loaded,
  mocks,
  rows,
  seedFeedItems,
  seedSavedPages,
  setArticleRead,
  stores,
} from './read-support';
import { deferred, failure, feedItem, feedItemRow, savedPage } from './support';

/** One row's read control (LIB-READ-1, LIB-READ-2, LIB-COUNT-2). */

describe('the read control of a row', () => {
  it('LIB-READ-1 toggles the row and moves the count by one', async () => {
    stores.savedPages = 3;
    await seedSavedPages([savedPage({ id: 'p2' }), savedPage({ id: 'p1' })]);

    await expect(setArticleRead(loaded('p1'), true)).resolves.toBe(true);

    expect(loaded('p1').item.read).toBe(true);
    expect(mocks.markSavedPage).toHaveBeenCalledWith('p1', true);
    expect(stores.savedPages).toBe(2);

    await setArticleRead(loaded('p1'), false);

    expect(loaded('p1').item.read).toBe(false);
    expect(mocks.markSavedPage).toHaveBeenLastCalledWith('p1', false);
    expect(stores.savedPages).toBe(3);
  });

  it('LIB-COUNT-2 reads the count again once the mark settles', async () => {
    await seedSavedPages([savedPage({ id: 'p1' })]);

    await setArticleRead(loaded('p1'), true);

    expect(mocks.reloadSavedPageCount).toHaveBeenCalled();
  });

  it('Scenario: A failed read mark rolls back', async () => {
    stores.savedPages = 1;
    mocks.markSavedPage.mockRejectedValueOnce(
      failure('SavedPageRepositoryError')
    );
    await seedSavedPages([savedPage({ id: 'p1' })]);

    await expect(setArticleRead(loaded('p1'), true)).resolves.toBe(false);

    expect(loaded('p1').item.read).toBe(false);
    expect(stores.savedPages).toBe(1);
    expect(mocks.reloadSavedPageCount).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      '暂时无法访问稍后阅读，请稍后重试',
      'error'
    );
  });
});

/** Two toggles of one row, whose two answers the test settles in the order it wants. */
const twoToggles = async () => {
  const first = deferred<void>();
  const second = deferred<void>();

  mocks.markSavedPage
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  stores.savedPages = 1;
  await seedSavedPages([savedPage({ id: 'p1' })]);

  return {
    first,
    second,
    read: setArticleRead(loaded('p1'), true),
    unread: setArticleRead(loaded('p1'), false),
  };
};

describe('two marks of one row', () => {
  it('LIB-READ-1 lets the last answer win', async () => {
    const slow = deferred<void>();

    mocks.markSavedPage
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(undefined);
    stores.savedPages = 1;
    await seedSavedPages([savedPage({ id: 'p1' })]);

    const first = setArticleRead(loaded('p1'), true);
    await setArticleRead(loaded('p1'), false);
    slow.reject(failure('SavedPageRepositoryError'));
    await first;

    expect(loaded('p1').item.read).toBe(false);
    expect(stores.savedPages).toBe(1);
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it('Scenario: Opening an unread article keeps its row as read', async () => {
    stores.feedCounts.set('feed-1', 2);
    await seedFeedItems([feedItem({ id: 'i1', feedId: 'feed-1' })], {
      kind: 'all',
    });

    await setArticleRead(feedItemRow({ id: 'i1', feedId: 'feed-1' }), true);

    expect(rows()).toHaveLength(1);
    expect(loaded('i1').item.read).toBe(true);
    expect(mocks.markFeedItem).toHaveBeenCalledWith('i1', true);
    expect(stores.feedCounts.get('feed-1')).toBe(1);
    expect(mocks.reloadCounts).toHaveBeenCalled();
  });
});

describe('two marks whose two answers succeed', () => {
  it('LIB-READ-1: the answer that arrives last decides the row', async () => {
    const { first, second, read, unread } = await twoToggles();

    second.resolve(undefined);
    await unread;

    expect(loaded('p1').item.read).toBe(false);

    first.resolve(undefined);
    await read;

    expect(loaded('p1').item.read).toBe(true);
  });

  it('LIB-READ-1: a first answer that arrives last decides the row', async () => {
    const { first, second, read, unread } = await twoToggles();

    first.resolve(undefined);
    await read;

    expect(loaded('p1').item.read).toBe(true);

    second.resolve(undefined);
    await unread;

    expect(loaded('p1').item.read).toBe(false);
  });
});

describe('an answer older than the list', () => {
  it('LIB-READ-1: a mark that settles after a reload leaves the reloaded row', async () => {
    const answer = deferred<void>();

    mocks.markSavedPage.mockReturnValueOnce(answer.promise);
    await seedSavedPages([savedPage({ id: 'p1', read: true })]);

    const pending = setArticleRead(loaded('p1'), false);

    await seedSavedPages([savedPage({ id: 'p1', read: true })]);
    answer.resolve(undefined);
    await pending;

    expect(loaded('p1').item.read).toBe(true);
  });
});
