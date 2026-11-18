import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import { getSavedPageUnreadCount } from '../../../src/web/api/saved-page';
import {
  adjustSavedPageUnread,
  clearSavedPageUnread,
  reloadSavedPageCount,
  savedPageUnreadCount,
} from '../../../src/web/saved-page/count';

/** The unread count of `稍后阅读` (SP-COUNT, LIB-COUNT-2, LIB-READ-4). */

vi.mock('../../../src/web/api/saved-page', () => ({
  getSavedPageUnreadCount: vi.fn(),
}));

describe('the unread count of 稍后阅读', () => {
  it('SP-COUNT-1: reading it again takes the number the server reports', async () => {
    vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 3 });

    await reloadSavedPageCount();

    expect(savedPageUnreadCount()).toBe(3);
  });

  it('LIB-COUNT-2: a count that fails to load keeps the last known count', async () => {
    vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 4 });
    await reloadSavedPageCount();
    vi.mocked(getSavedPageUnreadCount).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    await reloadSavedPageCount();

    expect(savedPageUnreadCount()).toBe(4);
  });

  it('LIB-COUNT-2: a mark moves the count by one', () => {
    clearSavedPageUnread();

    adjustSavedPageUnread(1);

    expect(savedPageUnreadCount()).toBe(1);

    adjustSavedPageUnread(-1);

    expect(savedPageUnreadCount()).toBe(0);
  });

  it('LIB-READ-4: marking the whole scope read zeroes the count', async () => {
    vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 5 });
    await reloadSavedPageCount();

    clearSavedPageUnread();

    expect(savedPageUnreadCount()).toBe(0);
  });
});
