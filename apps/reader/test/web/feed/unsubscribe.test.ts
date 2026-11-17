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
import {
  getFeedUnreadCounts,
  listFeeds,
  unsubscribeFeed as requestUnsubscribe,
} from '../../../src/web/api/feed';
import {
  allUnreadCount,
  feedUnreadCount,
  reloadCounts,
} from '../../../src/web/feed/counts';
import { type Feed, feeds, loadFeeds } from '../../../src/web/feed/list';
import { confirmUnsubscribe } from '../../../src/web/feed/unsubscribe';
import { currentScope, selectScope } from '../../../src/web/library';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture } from './support';

/** Unsubscribing a feed: confirm, remove with its items and count, roll back on failure. */

const goBlog = feedFixture('feed-go', 'Go Blog');
const rustBlog = feedFixture('feed-rust', 'Rust Blog');

const loadFeedList = async (items: ReadonlyArray<Feed>) => {
  vi.mocked(listFeeds).mockResolvedValue({ items } as never);
  vi.mocked(getFeedUnreadCounts).mockResolvedValue({
    items: [
      { feedId: 'feed-go', count: 3 },
      { feedId: 'feed-rust', count: 2 },
    ],
  } as never);
  await loadFeeds();
  await reloadCounts();
};

beforeEach(async () => {
  vi.mocked(requestUnsubscribe).mockReset();
  vi.mocked(requestUnsubscribe).mockResolvedValue(undefined as never);
  vi.mocked(showToast).mockClear();
  vi.mocked(selectScope).mockClear();
  vi.mocked(currentScope).mockReturnValue({ kind: 'later' });
  globalThis.confirm = vi.fn(() => true);
  await loadFeedList([goBlog, rustBlog]);
});

describe('Scenario: Confirming the removal', () => {
  it('removes the feed and drops its unread count without a success toast', async () => {
    confirmUnsubscribe(goBlog);

    expect(globalThis.confirm).toHaveBeenCalledWith(
      '取消订阅并删除该源的文章？已保存的稍后阅读不会删除。'
    );
    expect(feeds().map((feed) => feed.id)).toEqual(['feed-rust']);
    expect(feedUnreadCount('feed-go')).toBe(0);
    expect(allUnreadCount()).toBe(2);
    expect(showToast).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(requestUnsubscribe).toHaveBeenCalledWith('feed-go')
    );
  });
});

describe('Scenario: Cancelling the removal changes nothing', () => {
  it('sends no request and keeps the feed with its count', async () => {
    globalThis.confirm = vi.fn(() => false);

    confirmUnsubscribe(goBlog);

    expect(feeds().map((feed) => feed.id)).toEqual(['feed-go', 'feed-rust']);
    expect(feedUnreadCount('feed-go')).toBe(3);
    expect(requestUnsubscribe).not.toHaveBeenCalled();
  });
});

describe('Scenario: Removing the feed I am reading returns to all subscriptions', () => {
  it('selects 全部订阅 when the removed feed is the open scope', async () => {
    vi.mocked(currentScope).mockReturnValue({ kind: 'feed', id: 'feed-go' });

    confirmUnsubscribe(goBlog);

    await vi.waitFor(() =>
      expect(selectScope).toHaveBeenCalledWith({ kind: 'all' })
    );
  });

  it('leaves another scope selected', async () => {
    vi.mocked(currentScope).mockReturnValue({ kind: 'feed', id: 'feed-rust' });

    confirmUnsubscribe(goBlog);

    await vi.waitFor(() =>
      expect(requestUnsubscribe).toHaveBeenCalledWith('feed-go')
    );
    expect(selectScope).not.toHaveBeenCalled();
  });
});

describe('Scenario: The removal fails', () => {
  it('puts the row and its count back and shows the error', async () => {
    vi.mocked(requestUnsubscribe).mockRejectedValue(
      new ApiFailure('FeedRepositoryError')
    );
    vi.mocked(currentScope).mockReturnValue({ kind: 'feed', id: 'feed-go' });

    confirmUnsubscribe(goBlog);

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        '暂时无法访问订阅，请稍后重试',
        'error'
      )
    );
    expect(feeds().map((feed) => feed.id)).toEqual(['feed-go', 'feed-rust']);
    expect(feedUnreadCount('feed-go')).toBe(3);
    expect(allUnreadCount()).toBe(5);
    expect(selectScope).not.toHaveBeenCalled();
  });
});
