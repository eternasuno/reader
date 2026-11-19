import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Feed,
  FeedItem,
  FeedUnreadCount,
  Folder,
  SavedPage,
} from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
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

const _queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
};
const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const _requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

const _fetchCount = (): number => fetchMock.mock.calls.length;
const _pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};
const makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});
const makePage = (
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

describe('first page load', () => {
  it('loads the first saved-page page with limit 30', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' }), makePage({ id: 'p2', read: true })],
      cursor: 'p2',
    });

    expect(requestUrl()).toContain('/api/saved-pages?limit=30');
    expect(state.rows()).toHaveLength(2);
    expect(state.rows()[0].kind).toBe('later');
    expect(state.rows()[0].sourceTitle).toBe('example.com');
    expect(state.cursor()).toBe('p2');
    expect(state.activeScope()).toEqual({ kind: 'later' });
    expect(state.loadingInitial()).toBe(false);
    expect(state.loadError()).toBeNull();
  });
});

describe('first page params', () => {
  it('passes unread and order for single-feed lists', async () => {
    queue({ items: [], cursor: null });
    await state.loadScopeFirstPage(
      { kind: 'feed', feedId: 'f1' },
      true,
      'oldest'
    );
    solid.flush();

    expect(requestUrl()).toBe(
      '/api/feeds/f1/items?limit=30&unread=true&order=oldest'
    );
    expect(state.activeUnreadOnly()).toBe(true);
    expect(state.activeOrder()).toBe('oldest');
  });
});

describe('scope endpoints', () => {
  it('uses the folder and all-feeds endpoints', async () => {
    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'd1' }, false);
    solid.flush();
    expect(requestUrl()).toBe('/api/folders/d1/items?limit=30&unread=false');
    expect(state.rows()[0].kind).toBe('feed');

    queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'all' }, false, 'oldest');
    solid.flush();
    expect(requestUrl(1)).toBe('/api/feed-items?limit=30&unread=false');
    expect(state.activeOrder()).toBe('newest');
    expect(state.rows()).toHaveLength(0);
  });
});

describe('row labels', () => {
  it('labels feed rows with the feed title', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1', title: 'Go Blog' })],
    });

    expect(state.rows()[0].kind).toBe('feed');
    expect(state.rows()[0].sourceTitle).toBe('Go Blog');
  });
});
