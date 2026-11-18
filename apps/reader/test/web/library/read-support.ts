import { beforeEach, vi } from 'vitest';
import * as list from '../../../src/web/library/list';
import * as read from '../../../src/web/library/read';
import type {
  Article,
  FeedItem,
  SavedPage,
  Scope,
} from '../../../src/web/library/scope';
import { feedItem } from './support';

/**
 * The read marking's surroundings: the API functions, the toast store and the
 * feed, folder and saved-page stores it reads and adjusts, all doubled, plus
 * the seeding helpers the tests share.
 *
 * `vi.mock` is hoisted above this module's imports, so its doubles are in place
 * before the stores load — but only for what this module imports itself. A test
 * therefore imports the actions under test from here, never from `library/`
 * directly, or the stores would load before the doubles exist.
 */

const fake = vi.hoisted(() => ({
  mocks: {
    reloadSavedPageCount: vi.fn(async () => undefined),
    reloadCounts: vi.fn(async () => undefined),
    showToast: vi.fn(),
    listSavedPages: vi.fn(),
    listFeedItems: vi.fn(),
    listFeedItemsOfFeed: vi.fn(),
    listFolderItems: vi.fn(),
    markSavedPage: vi.fn(),
    markSavedPages: vi.fn(),
    markAllSavedPages: vi.fn(),
    markFeedItem: vi.fn(),
    markFeedItems: vi.fn(),
    markAllFeedItems: vi.fn(),
    markFeedRead: vi.fn(),
    markFolderRead: vi.fn(),
  },
  /** The other modules' stores, as the read marking sees them. */
  stores: {
    savedPages: 0,
    feedCounts: new Map<string, number>(),
    feeds: [{ id: 'feed-1' }, { id: 'feed-2' }],
    folderFeeds: new Map<string, Array<string>>([['folder-1', ['feed-1']]]),
  },
}));

vi.mock('../../../src/web/api/saved-page', () => ({
  listSavedPages: fake.mocks.listSavedPages,
  markSavedPage: fake.mocks.markSavedPage,
  markSavedPages: fake.mocks.markSavedPages,
  markAllSavedPages: fake.mocks.markAllSavedPages,
}));

vi.mock('../../../src/web/api/feed-item', () => ({
  listFeedItems: fake.mocks.listFeedItems,
  markFeedItem: fake.mocks.markFeedItem,
  markFeedItems: fake.mocks.markFeedItems,
  markAllFeedItems: fake.mocks.markAllFeedItems,
}));

vi.mock('../../../src/web/api/feed', () => ({
  listFeedItemsOfFeed: fake.mocks.listFeedItemsOfFeed,
  markFeedRead: fake.mocks.markFeedRead,
}));

vi.mock('../../../src/web/api/folder', () => ({
  listFolderItems: fake.mocks.listFolderItems,
  markFolderRead: fake.mocks.markFolderRead,
}));

vi.mock('../../../src/web/ui/toast', () => ({
  showToast: fake.mocks.showToast,
}));

vi.mock('../../../src/web/feed', () => ({
  feeds: () => fake.stores.feeds,
  feedById: (id: string) => fake.stores.feeds.find((feed) => feed.id === id),
  feedOrder: () => 'newest',
  feedUnreadCount: (id: string) => fake.stores.feedCounts.get(id) ?? 0,
  allUnreadCount: () =>
    [...fake.stores.feedCounts.values()].reduce((sum, count) => sum + count, 0),
  folderUnreadCount: () => 0,
  adjustFeedUnread: (id: string, delta: number) => {
    const counts = fake.stores.feedCounts;

    counts.set(id, (counts.get(id) ?? 0) + delta);
  },
  countsSnapshot: () => new Map(fake.stores.feedCounts),
  restoreCounts: (snapshot: ReadonlyMap<string, number>) => {
    fake.stores.feedCounts.clear();
    for (const [id, count] of snapshot) fake.stores.feedCounts.set(id, count);
  },
  clearUnread: (ids: ReadonlyArray<string>) => {
    for (const id of ids) fake.stores.feedCounts.set(id, 0);
  },
  reloadCounts: fake.mocks.reloadCounts,
  loadSidebar: async () => undefined,
  FeedSection: () => null,
  FeedMenuItems: () => null,
}));

vi.mock('../../../src/web/folder', () => ({
  folders: () => [],
  folderById: () => undefined,
  feedIdsInFolder: (id: string) => fake.stores.folderFeeds.get(id) ?? [],
  FolderMenuItems: () => null,
}));

vi.mock('../../../src/web/saved-page', () => ({
  savedPageUnreadCount: () => fake.stores.savedPages,
  adjustSavedPageUnread: (delta: number) => {
    fake.stores.savedPages += delta;
  },
  clearSavedPageUnread: () => {
    fake.stores.savedPages = 0;
  },
  reloadSavedPageCount: fake.mocks.reloadSavedPageCount,
  openAddLink: () => undefined,
  AddLinkDialog: () => null,
  LaterMenuItems: () => null,
  removeSavedPage: async () => true,
  saveToLater: async () => undefined,
}));

export const mocks = fake.mocks;

export const stores = fake.stores;

export const reloadList = list.reloadList;

export const rows = list.rows;

export const markAllInScope = read.markAllInScope;

export const markLoadedRead = read.markLoadedRead;

export const setArticleRead = read.setArticleRead;

const answers = [
  fake.mocks.markSavedPage,
  fake.mocks.markSavedPages,
  fake.mocks.markAllSavedPages,
  fake.mocks.markFeedItem,
  fake.mocks.markFeedItems,
  fake.mocks.markAllFeedItems,
  fake.mocks.markFeedRead,
  fake.mocks.markFolderRead,
];

beforeEach(() => {
  vi.resetAllMocks();
  for (const answer of answers) answer.mockResolvedValue(undefined);
  fake.mocks.reloadSavedPageCount.mockResolvedValue(undefined);
  fake.mocks.reloadCounts.mockResolvedValue(undefined);
  fake.stores.savedPages = 0;
  fake.stores.feedCounts.clear();
});

const page = (items: ReadonlyArray<unknown>) => ({ items, cursor: null });

export const seedSavedPages = async (items: ReadonlyArray<SavedPage>) => {
  fake.mocks.listSavedPages.mockResolvedValue(page(items));
  await list.reloadList({ kind: 'later' }, false);
};

export const seedFeedItems = async (
  items: ReadonlyArray<FeedItem>,
  scope: Scope
) => {
  fake.mocks.listFeedItems.mockResolvedValue(page(items));
  fake.mocks.listFeedItemsOfFeed.mockResolvedValue(page(items));
  fake.mocks.listFolderItems.mockResolvedValue(page(items));
  await list.reloadList(scope, false);
};

export const loaded = (id: string): Article => {
  const article = list.rowById(id);

  if (article === undefined) throw new Error(`row ${id} is not loaded`);

  return article;
};

export const feedItemsOf = (count: number, unread: number, feedId: string) =>
  Array.from({ length: count }, (_, index) =>
    feedItem({ id: `i${index}`, read: index >= unread, feedId })
  );
