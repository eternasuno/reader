import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listState,
  loadNextPage,
  prependRow,
  reloadList,
  removeRow,
  replaceRow,
  retryList,
  rows,
  setRowsRead,
} from '../../../src/web/library/list';
import {
  deferred,
  failure,
  feedItem,
  idOf,
  savedPage,
  savedPageRow,
} from './support';

const api = vi.hoisted(() => ({
  listSavedPages: vi.fn(),
  listFeedItems: vi.fn(),
  listFeedItemsOfFeed: vi.fn(),
  listFolderItems: vi.fn(),
}));

const stored = vi.hoisted(() => ({
  orders: new Map<string, 'newest' | 'oldest'>(),
}));

vi.mock('../../../src/web/api/saved-page', () => ({
  listSavedPages: api.listSavedPages,
}));

vi.mock('../../../src/web/api/feed-item', () => ({
  listFeedItems: api.listFeedItems,
}));

vi.mock('../../../src/web/api/feed', () => ({
  listFeedItemsOfFeed: api.listFeedItemsOfFeed,
}));

vi.mock('../../../src/web/api/folder', () => ({
  listFolderItems: api.listFolderItems,
}));

vi.mock('../../../src/web/feed', () => ({
  feedOrder: (id: string) => stored.orders.get(id) ?? 'newest',
}));

const emptyPage = { items: [], cursor: null };

const page = (items: ReadonlyArray<unknown>, cursor: string | null) => ({
  items,
  cursor,
});

const ids = () => rows().map(idOf);

const firstPage = async (first: unknown, second?: unknown) => {
  api.listSavedPages.mockResolvedValueOnce(first);

  if (second !== undefined) api.listSavedPages.mockResolvedValueOnce(second);

  await reloadList({ kind: 'later' }, false);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a page request', () => {
  it('LIB-LIST-2 asks the first page with limit 30, the filter and no cursor', async () => {
    api.listSavedPages.mockResolvedValue(emptyPage);

    await reloadList({ kind: 'later' }, true);

    expect(api.listSavedPages).toHaveBeenCalledWith({
      limit: 30,
      unread: true,
      cursor: undefined,
    });
  });

  it('LIB-SCOPE-2 lists each scope through its own endpoint', async () => {
    api.listFeedItems.mockResolvedValue(emptyPage);
    api.listFeedItemsOfFeed.mockResolvedValue(emptyPage);
    api.listFolderItems.mockResolvedValue(emptyPage);

    await reloadList({ kind: 'all' }, false);
    await reloadList({ kind: 'feed', id: 'feed-1' }, false);
    await reloadList({ kind: 'folder', id: 'folder-1' }, false);

    expect(api.listFeedItems).toHaveBeenCalledTimes(1);
    expect(api.listFeedItemsOfFeed).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ limit: 30 }),
      'newest'
    );
    expect(api.listFolderItems).toHaveBeenCalledWith(
      'folder-1',
      expect.objectContaining({ limit: 30 })
    );
  });

  it('LIB-LIST-1 keeps the rows in arrival order', async () => {
    api.listFeedItems.mockResolvedValue(
      page([feedItem({ id: 'i2' }), feedItem({ id: 'i1' })], null)
    );

    await reloadList({ kind: 'all' }, false);

    expect(ids()).toEqual(['i2', 'i1']);
  });
});

describe('paging to the next page', () => {
  it('Scenario: The next page loads near the end of the list', async () => {
    await firstPage(
      page([savedPage({ id: 'p2' })], 'p2'),
      page([savedPage({ id: 'p1' })], null)
    );
    await loadNextPage();

    expect(api.listSavedPages).toHaveBeenLastCalledWith({
      limit: 30,
      unread: false,
      cursor: 'p2',
    });
    expect(ids()).toEqual(['p2', 'p1']);
  });

  it('LIB-LIST-2 ends paging on a null cursor', async () => {
    await firstPage(page([savedPage({ id: 'p1' })], null));

    await loadNextPage();

    expect(api.listSavedPages).toHaveBeenCalledTimes(1);
  });

  it('LIB-LIST-2 keeps one page request in flight at a time', async () => {
    const next = deferred<unknown>();

    await firstPage(page([savedPage({ id: 'p2' })], 'p2'));
    api.listSavedPages.mockReturnValueOnce(next.promise);

    const first = loadNextPage();
    await loadNextPage();
    next.resolve(page([savedPage({ id: 'p1' })], null));
    await first;

    expect(api.listSavedPages).toHaveBeenCalledTimes(2);
  });
});

describe('a page that repeats a loaded row', () => {
  it('LIB-LIST-3 does not add a loaded row twice', async () => {
    await firstPage(
      page([savedPage({ id: 'p2' })], 'p2'),
      page([savedPage({ id: 'p2' }), savedPage({ id: 'p1' })], null)
    );

    await loadNextPage();

    expect(ids()).toEqual(['p2', 'p1']);
  });

  it('LIB-LIST-3 keeps a marked row read', async () => {
    await firstPage(
      page([savedPage({ id: 'p2' })], 'p2'),
      page([savedPage({ id: 'p2' })], null)
    );

    setRowsRead(['p2'], true);
    await loadNextPage();

    expect(rows()[0]?.item.read).toBe(true);
  });
});

describe('a page that fails', () => {
  it('Scenario: A failed page keeps the rows already loaded', async () => {
    api.listSavedPages
      .mockResolvedValueOnce(
        page([savedPage({ id: 'p3' }), savedPage({ id: 'p2' })], 'p2')
      )
      .mockRejectedValueOnce(failure('SavedPageRepositoryError'))
      .mockResolvedValueOnce(page([savedPage({ id: 'p1' })], null));

    await reloadList({ kind: 'later' }, false);
    await loadNextPage();

    expect(ids()).toEqual(['p3', 'p2']);
    expect(listState().error).toBe('暂时无法访问稍后阅读，请稍后重试');

    await retryList();

    expect(api.listSavedPages).toHaveBeenLastCalledWith({
      limit: 30,
      unread: false,
      cursor: 'p2',
    });
    expect(ids()).toEqual(['p3', 'p2', 'p1']);
    expect(listState().error).toBeUndefined();
  });

  it('LIB-LIST-4 retries the first page when no row was loaded', async () => {
    api.listSavedPages
      .mockRejectedValueOnce(failure('SavedPageRepositoryError'))
      .mockResolvedValueOnce(page([savedPage({ id: 'p1' })], null));

    await reloadList({ kind: 'later' }, false);

    expect(listState().loading).toBe(false);
    expect(listState().error).toBe('暂时无法访问稍后阅读，请稍后重试');

    await retryList();

    expect(api.listSavedPages).toHaveBeenLastCalledWith({
      limit: 30,
      unread: false,
      cursor: undefined,
    });
    expect(ids()).toEqual(['p1']);
    expect(listState().initialized).toBe(true);
  });
});

describe('a page of an older list', () => {
  it('Scenario: A page that resolves after a filter change is discarded', async () => {
    const slow = deferred<unknown>();

    api.listSavedPages
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(page([savedPage({ id: 'p2' })], null));

    const stale = reloadList({ kind: 'later' }, false);
    await reloadList({ kind: 'later' }, true);
    slow.resolve(page([savedPage({ id: 'p1' })], null));
    await stale;

    expect(ids()).toEqual(['p2']);
    expect(listState().unread).toBe(true);
  });
});

describe('changing a loaded row', () => {
  beforeEach(async () => {
    await firstPage(
      page([savedPage({ id: 'p2' }), savedPage({ id: 'p1' })], null)
    );
  });

  it('LIB-READ-1 changes a row without asking for the list again', () => {
    setRowsRead(['p1'], true);

    expect(rows()[1]?.item.read).toBe(true);
    expect(api.listSavedPages).toHaveBeenCalledTimes(1);
  });

  it('LIB-LIST-3 replaces a loaded row and ignores an unknown one', () => {
    replaceRow(savedPageRow({ id: 'p1', title: 'new' }));
    replaceRow(savedPageRow({ id: 'p9' }));

    expect(rows().map((row) => row.item.title)).toEqual(['p2', 'new']);
  });

  it('removeRow drops a loaded row at once', () => {
    removeRow('p2');

    expect(ids()).toEqual(['p1']);
  });
});

describe('a row that left the list', () => {
  it('later.md Removing a saved page: the restore puts the row back at its index', async () => {
    await firstPage(
      page(
        [
          savedPage({ id: 'p3' }),
          savedPage({ id: 'p2' }),
          savedPage({ id: 'p1' }),
        ],
        null
      )
    );

    const restore = removeRow('p2');

    expect(ids()).toEqual(['p3', 'p1']);

    restore();

    expect(ids()).toEqual(['p3', 'p2', 'p1']);
  });

  it('later.md Removing a saved page: the restore does nothing after a reload', async () => {
    await firstPage(
      page([savedPage({ id: 'p2' }), savedPage({ id: 'p1' })], null)
    );

    const restore = removeRow('p2');

    api.listSavedPages.mockResolvedValueOnce(
      page([savedPage({ id: 'p9' })], null)
    );
    await reloadList({ kind: 'later' }, false);
    restore();

    expect(ids()).toEqual(['p9']);
  });

  it('later.md Removing a saved page: a row that was not loaded has no restore', async () => {
    await firstPage(page([savedPage({ id: 'p1' })], null));

    const restore = removeRow('p9');

    restore();

    expect(ids()).toEqual(['p1']);
  });
});

describe('a row added while the list is shown', () => {
  it('later.md Adding a link: the new page goes to the top of the later list', async () => {
    await firstPage(
      page([savedPage({ id: 'p2' }), savedPage({ id: 'p1' })], null)
    );

    prependRow({ kind: 'later' }, savedPageRow({ id: 'p0' }));

    expect(ids()).toEqual(['p0', 'p2', 'p1']);
  });

  it('later.md Adding a link: a row already loaded is not added twice', async () => {
    await firstPage(page([savedPage({ id: 'p1' })], null));

    prependRow({ kind: 'later' }, savedPageRow({ id: 'p1', title: 'again' }));

    expect(ids()).toEqual(['p1']);
  });

  it('later.md Adding a link: another scope’s list is left alone', async () => {
    api.listFeedItems.mockResolvedValue(page([feedItem({ id: 'i1' })], null));
    await reloadList({ kind: 'all' }, false);

    prependRow({ kind: 'later' }, savedPageRow({ id: 'p0' }));

    expect(ids()).toEqual(['i1']);
  });
});

describe('a feed list order', () => {
  it('FD-PREF-3 lists a feed in its stored order on every page', async () => {
    stored.orders.set('feed-2', 'oldest');
    api.listFeedItemsOfFeed
      .mockResolvedValueOnce(page([feedItem({ id: 'i1' })], 'i1'))
      .mockResolvedValueOnce(emptyPage);

    await reloadList({ kind: 'feed', id: 'feed-2' }, false);
    stored.orders.set('feed-2', 'newest');
    await loadNextPage();

    expect(api.listFeedItemsOfFeed.mock.calls.map((call) => call[2])).toEqual([
      'oldest',
      'oldest',
    ]);
  });
});
