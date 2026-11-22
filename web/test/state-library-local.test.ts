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

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
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

describe('local saved pages', () => {
  it('prepends and removes saved pages locally with unread bookkeeping', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });
    queueSidebar({ saved: 1 });
    await state.refreshSidebar();
    solid.flush();

    state.prependSavedPageLocal(makePage({ id: 'p2', title: 'Fresh' }));
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p2', 'p1']);
    expect(state.savedUnreadCount()).toBe(2);

    state.prependSavedPageLocal(makePage({ id: 'p2', title: 'Fresh' }));
    solid.flush();
    expect(state.rows()).toHaveLength(2);
    expect(state.savedUnreadCount()).toBe(2);

    state.removeSavedPageLocal('p2');
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p1']);
    expect(state.savedUnreadCount()).toBe(1);

    state.removeSavedPageLocal('missing');
    solid.flush();
    expect(state.savedUnreadCount()).toBe(1);
  });
});

describe('local inserts outside scope', () => {
  it('skips local saved-page inserts outside the saved-page scope', async () => {
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
    });

    state.prependSavedPageLocal(makePage({ id: 'p2' }));
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['i1']);
  });
});
