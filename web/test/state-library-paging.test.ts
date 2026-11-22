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

const fetchCount = (): number => fetchMock.mock.calls.length;
const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};
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
const _makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
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

describe('stale page responses', () => {
  it('discards stale page responses from an earlier scope', async () => {
    const first = pending();
    const slow = state.loadScopeFirstPage({ kind: 'later' }, false);

    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    const fast = state.loadScopeFirstPage({ kind: 'all' }, false);
    await fast;
    solid.flush();

    first.resolve(json({ items: [makePage({ id: 'p1' })], cursor: 'p1' }));
    await slow;
    solid.flush();

    expect(state.activeScope()).toEqual({ kind: 'all' });
    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingInitial()).toBe(false);
  });
});

describe('next page guard', () => {
  it('appends the next page and allows only one page request in flight', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      cursor: 'p1',
    });

    queue({ items: [makePage({ id: 'p2' })], cursor: null });
    const first = state.loadNextPage();
    const second = state.loadNextPage();
    await Promise.all([first, second]);
    solid.flush();

    expect(fetchCount()).toBe(2);
    expect(requestUrl(1)).toBe(
      '/api/saved-pages?limit=30&unread=false&cursor=p1'
    );
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingMore()).toBe(false);

    await state.loadNextPage();
    expect(fetchCount()).toBe(2);
  });
});

describe('next page failure', () => {
  it('keeps rows and exposes a retry banner when the next page fails', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      cursor: 'p1',
    });

    queue({ error: 'SavedPageRepositoryError' }, 500);
    await state.loadNextPage();
    solid.flush();

    expect(state.rows()).toHaveLength(1);
    expect(state.cursor()).toBe('p1');
    expect(state.loadError()).toBe('SavedPageRepositoryError');
    expect(state.loadingMore()).toBe(false);

    queue({ items: [makePage({ id: 'p2' })], cursor: null });
    await state.retryLoad();
    solid.flush();

    expect(state.loadError()).toBeNull();
    expect(state.rows().map((row) => row.id)).toEqual(['p1', 'p2']);
  });
});

describe('first page retry', () => {
  it('retries page 1 when the initial load failed', async () => {
    queue({ error: 'FeedItemRepositoryError' }, 500);
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    expect(state.rows()).toHaveLength(0);
    expect(state.loadError()).toBe('FeedItemRepositoryError');

    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.retryLoad();
    solid.flush();

    expect(state.loadError()).toBeNull();
    expect(state.rows()).toHaveLength(1);
  });
});
