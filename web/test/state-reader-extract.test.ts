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

describe('extraction failure', () => {
  it('reverts to default and toasts when extraction fails', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1' })],
    });
    queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    queue({ error: 'ArticleEmptyContent' }, 422);
    await state.toggleExtractedMode();
    solid.flush();

    expect(state.displayMode()).toBe('default');
    expect(state.extracting()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('ArticleEmptyContent')
    );
  });
});

describe('adjacent articles', () => {
  it('derives adjacent articles from the loaded list only', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [
        makePage({ id: 'p1', read: true }),
        makePage({ id: 'p2', read: true }),
        makePage({ id: 'p3', read: true }),
      ],
    });

    queue({ item: makePage({ id: 'p2', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p2');
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({ prevId: 'p1', nextId: 'p3' });

    queue({ item: makePage({ id: 'p9', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p9');
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({ prevId: null, nextId: null });
  });
});

describe('read sync', () => {
  it('keeps the open article in sync when toggling read state', async () => {
    queue({ item: makePage({ id: 'p9', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p9');
    solid.flush();
    expect(state.openArticle()?.read).toBe(true);

    queueEmpty();
    await state.toggleArticleRead('p9', false, { kind: 'later', read: true });
    solid.flush();

    expect(state.openArticle()?.read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });
});
