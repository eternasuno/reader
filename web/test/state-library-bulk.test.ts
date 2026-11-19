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

const _requestBody = (call = 0): unknown => {
  const body = requestInit(call).body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

const fetchCount = (): number => fetchMock.mock.calls.length;
const pending = (): { resolve: (response: Response) => void } => {
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

describe('scope mark-all', () => {
  it('marks a single feed scope read with its own endpoint', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
      ],
      feeds: [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })],
      counts: [
        { feedId: 'f1', count: 1 },
        { feedId: 'f2', count: 1 },
      ],
    });

    queueEmpty();
    const before = fetchCount();
    await state.markScopeAllRead({ kind: 'feed', feedId: 'f1' });
    solid.flush();

    expect(requestUrl(before)).toBe('/api/feeds/f1/read-all');
    expect(state.rows().find((row) => row.id === 'i1')?.read).toBe(true);
    expect(state.rows().find((row) => row.id === 'i2')?.read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.feedUnreadCount('f2')).toBe(1);
  });
});

describe('saved mark-all', () => {
  it('zeroes the saved count when marking all saved pages read', async () => {
    queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    queueEmpty();
    const before = fetchCount();
    await state.markScopeAllRead();
    solid.flush();

    expect(requestUrl(before)).toBe('/api/saved-pages/read-all');
    expect(state.savedUnreadCount()).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('mark-all rollback', () => {
  it('rolls back a failed mark-all and reloads counts', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });

    queue({ error: 'FeedItemRepositoryError' }, 500);
    queueSidebar({
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });
    await state.markScopeAllRead({ kind: 'all' });
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.feedUnreadCount('f1')).toBe(1);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('FeedItemRepositoryError')
    );
  });
});

describe('stale rollback guard', () => {
  it('does not roll back read state after a newer scope has loaded', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
    });

    const failure = pending();
    const marking = state.markLoadedRead();
    solid.flush();

    queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    queueSidebar({ saved: 1 });
    failure.resolve(json({ error: 'SavedPageRepositoryError' }, 500));
    await marking;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
    expect(state.rows()[0].read).toBe(false);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
