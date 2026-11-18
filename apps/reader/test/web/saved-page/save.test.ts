import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import {
  getSavedPageUnreadCount,
  saveFeedItem,
} from '../../../src/web/api/saved-page';
import {
  clearSavedPageUnread,
  reloadSavedPageCount,
  savedPageUnreadCount,
} from '../../../src/web/saved-page/count';
import { saveToLater } from '../../../src/web/saved-page/save';
import { showToast } from '../../../src/web/ui/toast';
import { feedItemFixture, savedPageFixture } from './fixtures';

/** Saving an open feed item to `稍后阅读` (SP-SAVE, RD-SAVE). */

vi.mock('../../../src/web/api/saved-page', () => ({
  saveFeedItem: vi.fn(),
  getSavedPageUnreadCount: vi.fn(),
}));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  clearSavedPageUnread();
});

describe('saving a feed item to 稍后阅读', () => {
  it('Scenario: Saving an open feed item', async () => {
    vi.mocked(saveFeedItem).mockResolvedValue({
      item: savedPageFixture('page-1'),
    });
    vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 1 });

    await saveToLater(feedItemFixture('item-1'));

    expect(saveFeedItem).toHaveBeenCalledWith('item-1');
    expect(showToast).toHaveBeenCalledWith('已保存到稍后阅读');
    expect(savedPageUnreadCount()).toBe(1);
  });

  it('Scenario: Saving a page with an unread count that fails to load', async () => {
    vi.mocked(saveFeedItem).mockResolvedValue({
      item: savedPageFixture('page-1'),
    });
    vi.mocked(getSavedPageUnreadCount).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );
    await reloadSavedPageCount();

    await saveToLater(feedItemFixture('item-1'));

    expect(savedPageUnreadCount()).toBe(1);
  });

  it('Scenario: Saving a feed item that is already saved', async () => {
    vi.mocked(saveFeedItem).mockRejectedValue(
      new ApiFailure('SavedPageAlreadyExists', { url: 'https://example.com' })
    );

    await saveToLater(feedItemFixture('item-1'));

    expect(showToast).toHaveBeenCalledWith('该文章已在稍后阅读中', 'error');
    expect(savedPageUnreadCount()).toBe(0);
  });

  it('Scenario: Saving an item that no longer exists', async () => {
    vi.mocked(saveFeedItem).mockRejectedValue(
      new ApiFailure('FeedItemNotFound', { id: 'item-1' })
    );

    await saveToLater(feedItemFixture('item-1'));

    expect(showToast).toHaveBeenCalledWith('文章不存在，可能已被删除', 'error');
    expect(savedPageUnreadCount()).toBe(0);
  });
});
