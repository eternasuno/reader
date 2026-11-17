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
  previewFeed,
  subscribeFeed,
} from '../../../src/web/api/feed';
import { listFolders } from '../../../src/web/api/folder';
import { loadFeeds } from '../../../src/web/feed/list';
import {
  closeSubscribe,
  confirmSubscription,
  openSubscribe,
  previewAddress,
  returnToEdit,
  setSubscribeFolder,
  subscribeFolder,
  subscribeOpen,
  subscribePending,
  subscribePreview,
} from '../../../src/web/feed/subscribe';
import {
  folderCollapsed,
  toggleFolderCollapsed,
} from '../../../src/web/folder/collapse';
import { selectScope } from '../../../src/web/library';
import { showToast } from '../../../src/web/ui/toast';
import { feedFixture } from './support';

/** The `新增 RSS 订阅` dialog: preview, folder choice, subscribe, duplicates. */

const goBlog = feedFixture('feed-go', 'Go Blog');
const preview = {
  url: 'https://new.example.com/feed.xml',
  title: 'New Blog',
  titles: ['First', 'Second', 'Third', 'Fourth'],
};

const loadedFeeds = (items: ReadonlyArray<typeof goBlog>) =>
  ({ items }) as never;

beforeEach(async () => {
  vi.mocked(listFeeds).mockReset();
  vi.mocked(getFeedUnreadCounts).mockReset();
  vi.mocked(listFolders).mockReset();
  vi.mocked(previewFeed).mockReset();
  vi.mocked(subscribeFeed).mockReset();
  vi.mocked(showToast).mockClear();
  vi.mocked(selectScope).mockClear();

  vi.mocked(listFeeds).mockResolvedValue(loadedFeeds([]));
  vi.mocked(getFeedUnreadCounts).mockResolvedValue({ items: [] } as never);
  vi.mocked(listFolders).mockResolvedValue({ items: [] } as never);
  await loadFeeds();
  closeSubscribe();
});

describe('Scenario: The preview shows the source without storing it', () => {
  it('keeps the preview and subscribes nothing (FD-PREVIEW-1)', async () => {
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    openSubscribe();

    await previewAddress('https://new.example.com/feed.xml');

    expect(previewFeed).toHaveBeenCalledWith(
      'https://new.example.com/feed.xml'
    );
    expect(subscribePreview()?.title).toBe('New Blog');
    expect(subscribePreview()?.titles.slice(0, 3)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(subscribeFeed).not.toHaveBeenCalled();
  });
});

describe('Scenario: The address cannot be parsed as a feed', () => {
  it('toasts the wording and keeps the dialog and the form', async () => {
    vi.mocked(previewFeed).mockRejectedValue(new ApiFailure('FeedParserError'));
    openSubscribe();

    await previewAddress('https://example.com/not-a-feed');

    expect(showToast).toHaveBeenCalledWith(
      '无法解析订阅源，请确认地址正确',
      'error'
    );
    expect(subscribePreview()).toBeUndefined();
    expect(subscribeOpen()).toBe(true);
    expect(subscribePending()).toBeUndefined();
  });
});

describe('FD-PREVIEW-2 a preview is pending while it runs', () => {
  it('reports the pending state until the request settles', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(previewFeed).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)) as never
    );

    const running = previewAddress('https://new.example.com/feed.xml');

    expect(subscribePending()).toBe('preview');

    finish({ preview });
    await running;

    expect(subscribePending()).toBeUndefined();
  });
});

describe('Scenario: Confirming the preview adds the feed and opens it', () => {
  it('subscribes with the previewed url and title, toasts and opens the feed', async () => {
    const created = feedFixture('feed-new', 'New Blog');
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    vi.mocked(subscribeFeed).mockResolvedValue({ item: created } as never);
    openSubscribe();
    await previewAddress('https://new.example.com/feed.xml');

    await confirmSubscription();

    expect(subscribeFeed).toHaveBeenCalledWith({
      url: 'https://new.example.com/feed.xml',
      title: 'New Blog',
      folderId: undefined,
    });
    expect(showToast).toHaveBeenCalledWith('订阅已添加', 'success');
    expect(subscribeOpen()).toBe(false);
    expect(selectScope).toHaveBeenCalledWith({ kind: 'feed', id: 'feed-new' });
    expect(listFeeds).toHaveBeenCalledTimes(2);
  });

  it('subscribes into the chosen folder and expands it', async () => {
    const created = feedFixture('feed-new', 'New Blog', 'folder-tech');
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    vi.mocked(subscribeFeed).mockResolvedValue({ item: created } as never);
    toggleFolderCollapsed('folder-tech');
    expect(folderCollapsed('folder-tech')).toBe(true);
    openSubscribe();
    await previewAddress('https://new.example.com/feed.xml');
    setSubscribeFolder('folder-tech');

    await confirmSubscription();

    expect(subscribeFeed).toHaveBeenCalledWith({
      url: 'https://new.example.com/feed.xml',
      title: 'New Blog',
      folderId: 'folder-tech',
    });
    expect(folderCollapsed('folder-tech')).toBe(false);
    expect(selectScope).toHaveBeenCalledWith({ kind: 'feed', id: 'feed-new' });
  });
});

describe('Scenario: Subscribing to a feed I already follow opens it', () => {
  const duplicate = () =>
    new ApiFailure('FeedAlreadyExists', { url: goBlog.url });

  it('shows the success toast and opens the feed already in the list', async () => {
    vi.mocked(listFeeds).mockResolvedValue(loadedFeeds([goBlog]));
    await loadFeeds();
    vi.mocked(listFeeds).mockClear();
    vi.mocked(previewFeed).mockResolvedValue({
      preview: { ...preview, url: goBlog.url, title: 'Go Blog' },
    });
    vi.mocked(subscribeFeed).mockRejectedValue(duplicate());
    openSubscribe();
    await previewAddress(goBlog.url);

    await confirmSubscription();

    expect(showToast).toHaveBeenCalledWith('该订阅已存在', 'success');
    expect(subscribeOpen()).toBe(false);
    expect(selectScope).toHaveBeenCalledWith({ kind: 'feed', id: 'feed-go' });
    expect(listFeeds).not.toHaveBeenCalled();
  });

  it('lists the feeds once more when the existing feed is not loaded yet', async () => {
    vi.mocked(previewFeed).mockResolvedValue({
      preview: { ...preview, url: goBlog.url },
    });
    vi.mocked(subscribeFeed).mockRejectedValue(duplicate());
    vi.mocked(listFeeds).mockResolvedValue(loadedFeeds([goBlog]));
    openSubscribe();
    await previewAddress(goBlog.url);

    await confirmSubscription();

    expect(listFeeds).toHaveBeenCalledTimes(2);
    expect(selectScope).toHaveBeenCalledWith({ kind: 'feed', id: 'feed-go' });
  });

  it('closes the dialog and leaves the scope alone when the feed is gone', async () => {
    vi.mocked(previewFeed).mockResolvedValue({
      preview: { ...preview, url: goBlog.url },
    });
    vi.mocked(subscribeFeed).mockRejectedValue(duplicate());
    openSubscribe();
    await previewAddress(goBlog.url);

    await confirmSubscription();

    expect(showToast).toHaveBeenCalledWith('该订阅已存在', 'success');
    expect(subscribeOpen()).toBe(false);
    expect(selectScope).not.toHaveBeenCalled();
  });
});

describe('Scenario: The subscription fails', () => {
  it('keeps the dialog and the preview and shows the error', async () => {
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    vi.mocked(subscribeFeed).mockRejectedValue(
      new ApiFailure('FeedRepositoryError')
    );
    openSubscribe();
    await previewAddress('https://new.example.com/feed.xml');

    await confirmSubscription();

    expect(showToast).toHaveBeenCalledWith(
      '暂时无法访问订阅，请稍后重试',
      'error'
    );
    expect(subscribeOpen()).toBe(true);
    expect(subscribePreview()?.title).toBe('New Blog');
    expect(selectScope).not.toHaveBeenCalled();
  });
});

describe('folders.md: the dialog resets its state', () => {
  it('reopening resets the folder choice and the preview', async () => {
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    openSubscribe();
    await previewAddress('https://new.example.com/feed.xml');
    setSubscribeFolder('folder-tech');

    closeSubscribe();
    openSubscribe();

    expect(subscribeFolder()).toBeUndefined();
    expect(subscribePreview()).toBeUndefined();
  });

  it('返回修改 drops the preview and keeps the chosen folder', async () => {
    vi.mocked(previewFeed).mockResolvedValue({ preview } as never);
    openSubscribe();
    await previewAddress('https://new.example.com/feed.xml');
    setSubscribeFolder('folder-tech');

    returnToEdit();

    expect(subscribePreview()).toBeUndefined();
    expect(subscribeFolder()).toBe('folder-tech');
  });
});
