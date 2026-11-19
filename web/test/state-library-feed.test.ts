import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Feed,
  FeedItem,
  FeedUnreadCount,
  Folder,
  SavedPage,
} from '../src/api';

type StateModule = typeof import('../src/state');
type I18nModule = typeof import('../src/i18n');
type UiModule = typeof import('../src/ui');

let state: StateModule;
let solid: typeof import('solid-js');
let i18n: I18nModule;
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
  state = await import('../src/state');
};

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  await fresh();
});
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noContent = (): Response => new Response(null, { status: 204 });

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};

const queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
};
const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

const requestBody = (call = 0): unknown => {
  const body = requestInit(call).body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

const fetchCount = (): number => fetchMock.mock.calls.length;
const makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});
const _makePage = (
  overrides: Partial<SavedPage> & { id: string }
): SavedPage => ({
  url: `https://example.com/${overrides.id}`,
  title: `Page ${overrides.id}`,
  content: '<p>content</p>',
  read: false,
  ...overrides,
});

const makeItem = (
  overrides: Partial<FeedItem> & { id: string; feedId: string }
): FeedItem => ({
  url: `https://example.com/${overrides.id}`,
  title: `Item ${overrides.id}`,
  description: '<p>summary</p>',
  content: '<p>content</p>',
  read: false,
  ...overrides,
});
const queueSidebar = (
  options: {
    feeds?: Array<Feed>;
    folders?: Array<Folder>;
    counts?: Array<FeedUnreadCount>;
    saved?: number;
  } = {}
): void => {
  queue({ items: options.feeds ?? [] });
  queue({ items: options.folders ?? [] });
  queue({ items: options.counts ?? [] });
  queue({ count: options.saved ?? 0 });
};
const queueLoadedLibrary = async (options: {
  scope: Parameters<StateModule['loadScopeFirstPage']>[0];
  items: Array<SavedPage | FeedItem>;
  cursor?: string | null;
  feeds?: Array<Feed>;
  counts?: Array<FeedUnreadCount>;
  saved?: number;
}): Promise<void> => {
  // `LIB-RELOAD-1`: the sidebar (and therefore feed titles) is refreshed when entering a scope.
  if (options.feeds !== undefined) {
    queueSidebar({
      feeds: options.feeds,
      counts: options.counts,
      saved: options.saved,
    });
    await state.refreshSidebar();
    solid.flush();
  }

  queue({ items: options.items, cursor: options.cursor ?? null });
  await state.loadScopeFirstPage(options.scope, false);
  solid.flush();
};

describe('feed move', () => {
  it('moves a feed out of the open folder scope without reloading the list', async () => {
    const target = makeFeed({ id: 'f1', folderId: 'd1' });
    await queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
      ],
      feeds: [target, makeFeed({ id: 'f2', folderId: 'd1' })],
    });
    expect(state.rows()).toHaveLength(2);

    queueEmpty();
    const before = fetchCount();
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(before)).toBe('/api/feeds/f1');
    expect(requestInit(before).method).toBe('PATCH');
    expect(requestBody(before)).toEqual({ folderId: null });
    expect(state.feeds().find((feed) => feed.id === 'f1')?.folderId).toBeNull();
    expect(state.rows().map((row) => row.id)).toEqual(['i2']);
    expect(fetchCount()).toBe(before + 1);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('folders.movedToast'))
    );
  });
});

describe('feed move rollback', () => {
  it('rolls back a failed feed move and restores removed rows', async () => {
    const target = makeFeed({ id: 'f1', folderId: 'd1' });
    await queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [target],
    });

    queue({ error: 'FolderNotFound' }, 404);
    await expect(state.moveFeedToFolder(target, null)).resolves.toBe(false);
    solid.flush();

    expect(state.feeds().find((feed) => feed.id === 'f1')?.folderId).toBe('d1');
    expect(state.rows()).toHaveLength(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});

describe('feed order reload', () => {
  it('reloads the active feed list when its order changes', async () => {
    const target = makeFeed({ id: 'f1' });
    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: 'i1' });
    await state.loadScopeFirstPage(
      { kind: 'feed', feedId: 'f1' },
      false,
      'newest'
    );
    queueSidebar({ feeds: [target] });
    await state.refreshSidebar();
    solid.flush();

    queueEmpty();
    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    const before = fetchCount();
    await state.changeFeedOrder(target, 'oldest');
    solid.flush();

    expect(requestInit(before).method).toBe('PUT');
    expect(requestUrl(before)).toBe('/api/feeds/f1/order');
    expect(state.feeds()[0].order).toBe('oldest');
    expect(state.activeOrder()).toBe('oldest');
    expect(state.cursor()).toBeNull();
    expect(requestUrl(before + 1)).toBe(
      '/api/feeds/f1/items?limit=30&unread=false&order=oldest'
    );
  });
});

describe('stored feed order', () => {
  it('omits the order param so the stored feed order applies', async () => {
    queueSidebar({ feeds: [makeFeed({ id: 'f1', order: 'oldest' })] });
    await state.refreshSidebar();
    solid.flush();

    queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'feed', feedId: 'f1' }, false);
    solid.flush();

    expect(requestUrl(4)).toBe('/api/feeds/f1/items?limit=30&unread=false');
    expect(state.activeOrder()).toBe('oldest');
  });
});

describe('feed reader mode', () => {
  it('updates the feed reader mode and reports failures', async () => {
    const target = makeFeed({ id: 'f1' });
    queueSidebar({ feeds: [target] });
    await state.refreshSidebar();
    solid.flush();

    queueEmpty();
    const before = fetchCount();
    await state.changeFeedReaderMode(target, 'extracted');
    solid.flush();
    expect(requestUrl(before)).toBe('/api/feeds/f1/reader-mode');
    expect(state.feeds()[0].readerMode).toBe('extracted');

    queue({ error: 'FeedRepositoryError' }, 500);
    await state.changeFeedReaderMode(target, 'embedded');
    solid.flush();
    expect(state.feeds()[0].readerMode).toBe('extracted');
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
