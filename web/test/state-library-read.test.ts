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

describe('optimistic read toggle', () => {
  it('marks a row read optimistically and keeps it under the unread filter', async () => {
    queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, true);
    queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    queueEmpty();
    const before = fetchCount();
    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(true);
    solid.flush();

    expect(state.rows()).toHaveLength(1);
    expect(state.rows()[0].read).toBe(true);
    expect(state.savedUnreadCount()).toBe(0);
    expect(requestUrl(before)).toBe('/api/saved-pages/p1');
    expect(requestInit(before).method).toBe('PATCH');
    expect(requestBody(before)).toEqual({ read: true });
  });
});

describe('feed item read toggle', () => {
  it('marks a feed item read through the feed-items endpoint', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 1 }],
    });

    queueEmpty();
    const before = fetchCount();
    await expect(state.toggleArticleRead('i1', true)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(before)).toBe('/api/feed-items/i1');
    expect(state.feedUnreadCount('f1')).toBe(0);
    expect(state.rows()[0].read).toBe(true);
  });
});

describe('read no-op', () => {
  it('is a no-op when the read state already matches', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });

    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(true);
    expect(fetchCount()).toBe(1);
  });
});

describe('read toggle rollback', () => {
  it('rolls back a failed read toggle and reloads counts', async () => {
    queue({ items: [makePage({ id: 'p1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    queue({ error: 'SavedPageRepositoryError' }, 500);
    queueSidebar({ saved: 1 });
    const before = fetchCount();
    await expect(state.toggleArticleRead('p1', true)).resolves.toBe(false);
    solid.flush();

    expect(requestUrl(before)).toBe('/api/saved-pages/p1');
    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SavedPageRepositoryError')
    );
  });
});

describe('mark loaded read', () => {
  it('marks every loaded unread row read in one batch', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f1' }),
        makeItem({ id: 'i3', feedId: 'f1', read: true }),
      ],
      feeds: [makeFeed({ id: 'f1' })],
      counts: [{ feedId: 'f1', count: 2 }],
    });

    queueEmpty();
    const before = fetchCount();
    await state.markLoadedRead();
    solid.flush();

    expect(requestUrl(before)).toBe('/api/feed-items/read');
    expect(requestBody(before)).toEqual({ ids: ['i1', 'i2'] });
    expect(state.rows().every((row) => row.read)).toBe(true);
    expect(state.feedUnreadCount('f1')).toBe(0);

    const afterBatch = fetchCount();
    await state.markLoadedRead();
    expect(fetchCount()).toBe(afterBatch);
  });
});

describe('mark loaded read rollback', () => {
  it('rolls back a failed mark-loaded-read', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' })],
      saved: 1,
    });

    queue({ error: 'SavedPageRepositoryError' }, 500);
    queueSidebar({ saved: 1 });
    await state.markLoadedRead();
    solid.flush();

    expect(state.rows()[0].read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
    expect(ui.currentToast()?.variant).toBe('error');
  });
});
