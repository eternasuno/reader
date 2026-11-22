import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
let releaseMount: () => void = () => {};

const unmountLibrary = (): void => {
  releaseMount();
  releaseMount = () => {};
};

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
  state = await import('../src/state');
  releaseMount = state.trackLibraryMount();
};

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  await fresh();
});

afterEach(() => {
  unmountLibrary();
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

const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};

const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

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

describe('unsubscribeFeed reload', () => {
  it('reloads page 1 of an active aggregate scope after deleting a feed', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      cursor: 'iB1',
      feeds: [feedA, feedB],
    });

    const before = fetchCount();
    queueEmpty();
    queue({
      items: [
        makeItem({ id: 'iB1', feedId: 'fB' }),
        makeItem({ id: 'iB2', feedId: 'fB' }),
      ],
      cursor: null,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 2);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe('/api/feeds/fA');
    expect(requestUrl(before + 1)).toBe(
      '/api/feed-items?limit=30&unread=false'
    );
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fB']);
    expect(state.rows().map((row) => row.id)).toEqual(['iB1', 'iB2']);
    expect(state.cursor()).toBeNull();
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed unmounted', () => {
  it('skips the page-1 reload when unmounted', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      cursor: 'iB1',
      feeds: [feedA, feedB],
    });

    unmountLibrary();
    const before = fetchCount();
    queueEmpty();
    queue({
      items: [makeItem({ id: 'iB1', feedId: 'fB' })],
      cursor: null,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(requestInit(before).method).toBe('DELETE');
    expect(requestUrl(before)).toBe('/api/feeds/fA');
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fB']);
    expect(state.rows().map((row) => row.id)).toEqual(['iA1', 'iB1']);
    expect(ui.currentToast()).toMatchObject({
      message: String(i18n.t('feeds.unsubscribedToast')),
      variant: 'success',
    });
  });
});

describe('unsubscribeFeed stale page discard', () => {
  it('discards an in-flight page response requested before the delete', async () => {
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      cursor: 'iA1',
      feeds: [feedA, feedB],
    });

    const latePage = pending();
    const pendingNext = state.loadNextPage();

    queueEmpty();
    queue({
      items: [makeItem({ id: 'iB1', feedId: 'fB' })],
      cursor: null,
    });

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(true);
    solid.flush();

    latePage.resolve(
      json({
        items: [makeItem({ id: 'iA2', feedId: 'fA' })],
        cursor: 'iA2',
      })
    );
    await pendingNext;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['iB1']);
    expect(state.cursor()).toBeNull();
    expect(state.loadingMore()).toBe(false);
  });
});

describe('unsubscribeFeed failure', () => {
  it('returns false, shows an error toast, and keeps the feed on failure', async () => {
    const feedA = makeFeed({ id: 'fA' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      feeds: [feedA],
    });

    const before = fetchCount();
    queue({ error: 'FeedRepositoryError' }, 500);

    await expect(state.unsubscribeFeed(feedA)).resolves.toBe(false);
    solid.flush();

    expect(fetchCount()).toBe(before + 1);
    expect(state.feeds().map((feed) => feed.id)).toEqual(['fA']);
    expect(state.rows().map((row) => row.id)).toEqual(['iA1']);
    expect(ui.currentToast()).toMatchObject({
      message: i18n.translateErrorCode('FeedRepositoryError'),
      variant: 'error',
    });
  });
});
