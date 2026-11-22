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

describe('feed starting mode', () => {
  it('starts a feed item in its feed reader mode and extracts automatically', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1', readerMode: 'extracted' })],
    });

    queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    queue({
      item: makeItem({
        id: 'i1',
        feedId: 'f1',
        read: true,
        extractedContent: '<p>x</p>',
      }),
    });

    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    expect(state.displayMode()).toBe('extracted');
    const opened = state.openArticle();
    expect(
      opened !== null && opened.kind === 'feed'
        ? opened.extractedContent
        : undefined
    ).toBe('<p>x</p>');
    const firstRow = state.rows()[0];
    expect(
      firstRow.kind === 'feed' ? firstRow.extractedContent : undefined
    ).toBe('<p>x</p>');
    expect(requestUrl(fetchCount() - 1)).toBe('/api/feed-items/i1/extract');
    expect(state.extracting()).toBe(false);
  });
});

describe('saved and embedded modes', () => {
  it('starts saved pages in default and honours embedded feed mode', async () => {
    queue({ item: makePage({ id: 'p1', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();
    expect(state.displayMode()).toBe('default');

    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1', readerMode: 'embedded' })],
    });
    queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();
    expect(state.displayMode()).toBe('embedded');
  });
});

describe('extracted toggle', () => {
  it('toggles extracted mode and reuses cached content', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [
        makeItem({
          id: 'i1',
          feedId: 'f1',
          read: true,
          extractedContent: '<p>cached</p>',
        }),
      ],
      feeds: [makeFeed({ id: 'f1' })],
    });
    queue({
      item: makeItem({
        id: 'i1',
        feedId: 'f1',
        read: true,
        extractedContent: '<p>cached</p>',
      }),
    });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    const before = fetchCount();
    await state.toggleExtractedMode();
    solid.flush();
    expect(state.displayMode()).toBe('extracted');
    expect(fetchCount()).toBe(before);

    await state.toggleExtractedMode();
    solid.flush();
    expect(state.displayMode()).toBe('default');
  });
});

describe('embedded toggle', () => {
  it('toggles embedded mode', () => {
    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('embedded');

    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('default');
  });
});
