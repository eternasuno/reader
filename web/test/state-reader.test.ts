import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Feed,
  FeedItem,
  FeedUnreadCount,
  Folder,
  SavedPage,
} from '../src/api';

type StateModule = typeof import('../src/state');
type UiModule = typeof import('../src/ui');

let state: StateModule;
let solid: typeof import('solid-js');
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
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

const fetchCount = (): number => fetchMock.mock.calls.length;
const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};
const _makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
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

describe('empty route', () => {
  it('clears the reader when the route has no article', async () => {
    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('embedded');

    await state.openArticleByRoute({ kind: 'later' }, null);
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.displayMode()).toBe('default');
    expect(fetchCount()).toBe(0);
  });
});

describe('cached article', () => {
  it('renders a cached row immediately and then refreshes it from the server', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true, title: 'Cached' })],
    });

    const remote = pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    expect(state.openArticle()?.title).toBe('Cached');
    expect(state.loadingArticle()).toBe(true);

    remote.resolve(
      json({ item: makePage({ id: 'p1', read: true, title: 'Fresh' }) })
    );
    await opening;
    solid.flush();

    expect(state.openArticle()?.title).toBe('Fresh');
    expect(state.loadingArticle()).toBe(false);
  });
});

describe('missing article', () => {
  it('renders the empty reader when the remote lookup returns null', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });

    queue({ item: null });
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    expect(state.openArticleId()).toBe('p1');
    expect(state.openArticle()).toBeNull();
    expect(state.loadingArticle()).toBe(false);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('latest navigation', () => {
  it('lets the latest navigation win over a slow earlier response', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
    });

    const slow = pending();
    const openingA = state.openArticleByRoute({ kind: 'all' }, 'i1');
    queue({ item: makeItem({ id: 'i2', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'all' }, 'i2');
    solid.flush();

    slow.resolve(
      json({
        item: makeItem({ id: 'i1', feedId: 'f1', read: true, title: 'Stale' }),
      })
    );
    await openingA;
    solid.flush();

    expect(state.openArticleId()).toBe('i2');
    expect(state.openArticle()?.id).toBe('i2');
  });
});

describe('read on open', () => {
  it('marks an opened unread article read', async () => {
    queue({ item: makePage({ id: 'p1' }) });
    queueEmpty();

    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);
    expect(requestUrl(1)).toBe('/api/saved-pages/p1');
    expect(requestInit(1).method).toBe('PATCH');
  });
});
