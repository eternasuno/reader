import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../src/web/api/failure';
import {
  getSavedPageUnreadCount,
  removeSavedPage as removePageRequest,
} from '../../../src/web/api/saved-page';
import { removeRow } from '../../../src/web/library';
import {
  clearSavedPageUnread,
  reloadSavedPageCount,
  savedPageUnreadCount,
} from '../../../src/web/saved-page/count';
import {
  cancelRemoval,
  confirmRemoval,
  pendingRemoval,
  removeSavedPage,
} from '../../../src/web/saved-page/remove';
import { showToast } from '../../../src/web/ui/toast';
import { savedPageFixture } from './fixtures';

/** Removing a saved page with its confirmation (later.md: Removing a saved page). */

vi.mock('../../../src/web/api/saved-page', () => ({
  removeSavedPage: vi.fn(),
  getSavedPageUnreadCount: vi.fn(),
}));
vi.mock('../../../src/web/library', () => ({ removeRow: vi.fn() }));
vi.mock('../../../src/web/ui/toast', () => ({ showToast: vi.fn() }));

/** What `removeRow` answers: the row's place to go back to. */
const restore = vi.fn();

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSavedPageUnread();
  vi.mocked(getSavedPageUnreadCount).mockResolvedValue({ count: 2 });
  vi.mocked(removeRow).mockReturnValue(restore);
});

describe('the question before a removal', () => {
  it('Scenario: Cancelling the removal changes nothing', async () => {
    const page = savedPageFixture('page-1');

    const pending = removeSavedPage(page);

    expect(pendingRemoval()).toBe(page);

    cancelRemoval();

    await expect(pending).resolves.toBe(false);
    expect(pendingRemoval()).toBeUndefined();
    expect(removePageRequest).not.toHaveBeenCalled();
    expect(removeRow).not.toHaveBeenCalled();
  });

  it('a second question supersedes an unanswered one', async () => {
    vi.mocked(removePageRequest).mockResolvedValue(undefined);
    const first = removeSavedPage(savedPageFixture('page-1'));
    const second = removeSavedPage(savedPageFixture('page-2'));

    await expect(first).resolves.toBe(false);

    await confirmRemoval();

    await expect(second).resolves.toBe(true);
    expect(removeRow).toHaveBeenCalledWith('page-2');
  });
});

describe('a confirmed removal that succeeds', () => {
  it('Scenario: Removing the open saved page drops the row at once', async () => {
    const answer = deferred<undefined>();
    vi.mocked(removePageRequest).mockReturnValue(answer.promise);

    const pending = removeSavedPage(savedPageFixture('page-1'));
    const confirmed = confirmRemoval();

    expect(removeRow).toHaveBeenCalledWith('page-1');
    expect(restore).not.toHaveBeenCalled();

    answer.resolve(undefined);
    await confirmed;

    await expect(pending).resolves.toBe(true);
    expect(removePageRequest).toHaveBeenCalledWith('page-1');
    expect(pendingRemoval()).toBeUndefined();
    expect(restore).not.toHaveBeenCalled();
  });
});

describe('the count of a confirmed removal', () => {
  it('later.md Removing a saved page: an unread page lowers the count at once', async () => {
    await reloadSavedPageCount();

    const answer = deferred<undefined>();
    vi.mocked(removePageRequest).mockReturnValue(answer.promise);

    const pending = removeSavedPage(
      savedPageFixture('page-1', { read: false })
    );
    const confirmed = confirmRemoval();

    expect(savedPageUnreadCount()).toBe(1);

    answer.resolve(undefined);
    await confirmed;

    await expect(pending).resolves.toBe(true);
  });

  it('Scenario: the count drops by one when the removed page was unread', async () => {
    await reloadSavedPageCount();
    vi.mocked(removePageRequest).mockResolvedValue(undefined);
    vi.mocked(getSavedPageUnreadCount).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    const pending = removeSavedPage(
      savedPageFixture('page-1', { read: false })
    );
    await confirmRemoval();

    await expect(pending).resolves.toBe(true);
    expect(savedPageUnreadCount()).toBe(1);
  });

  it('Scenario: the count is untouched when the removed page was read', async () => {
    await reloadSavedPageCount();
    vi.mocked(removePageRequest).mockResolvedValue(undefined);
    vi.mocked(getSavedPageUnreadCount).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    const pending = removeSavedPage(savedPageFixture('page-2', { read: true }));
    await confirmRemoval();

    await expect(pending).resolves.toBe(true);
    expect(savedPageUnreadCount()).toBe(2);
  });
});

describe('a removal that fails', () => {
  it('Scenario: Removal fails puts the row back and reads the count again', async () => {
    await reloadSavedPageCount();
    vi.mocked(removePageRequest).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    const pending = removeSavedPage(
      savedPageFixture('page-1', { read: false })
    );
    await confirmRemoval();

    await expect(pending).resolves.toBe(false);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(getSavedPageUnreadCount).toHaveBeenCalledTimes(2);
    expect(savedPageUnreadCount()).toBe(2);
    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问稍后阅读，请稍后重试',
      'error'
    );
  });

  it('later.md Removing a saved page: a failed removal of a read page reads no count', async () => {
    await reloadSavedPageCount();
    vi.mocked(removePageRequest).mockRejectedValue(
      new ApiFailure('SavedPageRepositoryError')
    );

    const pending = removeSavedPage(savedPageFixture('page-2', { read: true }));
    await confirmRemoval();

    await expect(pending).resolves.toBe(false);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(getSavedPageUnreadCount).toHaveBeenCalledTimes(1);
    expect(savedPageUnreadCount()).toBe(2);
  });
});
