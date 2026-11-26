import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeFolder,
  makeItem,
  makePage,
  noContentResponse,
} from './support/state-fixture';

const BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

const seedPopulatedSession = async (): Promise<void> => {
  const { state, solid } = ctx;
  state.markAuthenticated();
  state.setSidebarCollapsedState(true);
  state.toggleFolderCollapse('d1');

  ctx.queueSidebar({
    feeds: [makeFeed({ id: 'f1', folderId: 'd1' })],
    folders: [makeFolder('d1')],
    counts: [{ feedId: 'f1', count: 4 }],
    saved: 2,
  });
  await state.refreshSidebar();
  ctx.queue({ items: [], cursor: null, boundary: BOUNDARY });
  await state.toggleAggregateOrder();
  ctx.queue({
    items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
    cursor: 'c1',
    boundary: BOUNDARY,
  });
  await state.loadScopeFirstPage({ kind: 'folder', folderId: 'd1' }, true);

  ctx.queue({ item: makePage({ id: 'p-deep', read: true }) });
  await state.openArticleByRoute({ kind: 'later' }, 'p-deep');
  state.toggleEmbeddedMode();
  solid.flush();
};

const assertPopulatedPreconditions = (state: typeof ctx.state): void => {
  expect(state.feeds().map((feed) => feed.id)).toEqual(['f1']);
  expect(state.folders().map((folder) => folder.id)).toEqual(['d1']);
  expect(state.savedUnreadCount()).toBe(2);
  expect(state.feedUnreadMap()).toEqual({ f1: 4 });
  expect(state.rows().map((row) => row.id)).toEqual(['i1']);
  expect(state.cursor()).toBe('c1');
  expect(state.activeScope()).toEqual({ kind: 'folder', folderId: 'd1' });
  expect(state.activeUnreadOnly()).toBe(true);
  expect(state.activeOrder()).toBe('oldest');
  expect(state.aggregateOrder()).toBe('oldest');
  expect(state.articleById('i1')).not.toBeNull();
  expect(state.articleById('p-deep')).not.toBeNull();
  expect(state.openArticleId()).toBe('p-deep');
  expect(state.openArticle()).not.toBeNull();
  expect(state.displayMode()).toBe('embedded');
};

describe('session clear: state reset', () => {
  it('clears sidebar, library, and reader state while keeping UI prefs', async () => {
    const { state, solid } = ctx;
    await seedPopulatedSession();
    assertPopulatedPreconditions(state);

    state.markUnauthenticated();
    solid.flush();

    expect(state.feeds()).toEqual([]);
    expect(state.folders()).toEqual([]);
    expect(state.savedUnreadCount()).toBe(0);
    expect(state.feedUnreadMap()).toEqual({});
    expect(state.sidebarCollapsed()).toBe(true);
    expect(state.collapsedFolders().has('d1')).toBe(true);

    expect(state.rows()).toEqual([]);
    expect(state.cursor()).toBeNull();
    expect(state.loadingInitial()).toBe(false);
    expect(state.loadingMore()).toBe(false);
    expect(state.loadError()).toBeNull();
    expect(state.activeScope()).toEqual({ kind: 'later' });
    expect(state.activeUnreadOnly()).toBe(false);
    expect(state.activeOrder()).toBe('newest');
    expect(state.aggregateOrder()).toBe('oldest');
    expect(state.articleById('i1')).toBeNull();
    expect(state.articleById('p-deep')).toBeNull();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.loadingArticle()).toBe(false);
    expect(state.displayMode()).toBe('default');
    expect(state.extracting()).toBe(false);
  });
});

describe('session clear: in-flight sidebar refresh', () => {
  it('ignores a sidebar refresh resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    const round = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'f1' })],
      folders: [makeFolder('d1')],
      counts: [{ feedId: 'f1', count: 5 }],
      saved: 3,
    });

    const pending = state.refreshSidebar();
    state.markUnauthenticated();
    round.resolve();
    await pending;
    solid.flush();

    expect(state.feeds()).toEqual([]);
    expect(state.folders()).toEqual([]);
    expect(state.feedUnreadMap()).toEqual({});
    expect(state.savedUnreadCount()).toBe(0);

    ctx.queueSidebar({ feeds: [makeFeed({ id: 'f2' })] });
    await state.ensureFeeds();
    solid.flush();
    expect(state.feeds().map((feed) => feed.id)).toEqual(['f2']);
  });
});

describe('session clear: in-flight first-page load', () => {
  it('ignores first-page load resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    const page1 = ctx.pending();
    const loading = state.loadScopeFirstPage({ kind: 'later' }, false);
    expect(state.loadingInitial()).toBe(true);

    state.markUnauthenticated();
    page1.resolve(
      jsonResponse({
        items: [makePage({ id: 'p1' })],
        cursor: 'c1',
        boundary: BOUNDARY,
      })
    );
    await loading;
    solid.flush();

    expect(state.rows()).toEqual([]);
    expect(state.cursor()).toBeNull();
    expect(state.loadingInitial()).toBe(false);
    expect(state.articleById('p1')).toBeNull();
  });
});

describe('session clear: in-flight next-page load', () => {
  it('ignores next-page load resolving after markUnauthenticated and protects new session', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
      cursor: 'c1',
    });

    const staleNext = ctx.pending();
    const staleLoad = state.loadNextPage();
    expect(state.loadingMore()).toBe(true);

    state.markUnauthenticated();
    expect(state.loadingMore()).toBe(false);

    ctx.queue({
      items: [makePage({ id: 'p2', read: true })],
      cursor: 'c2',
      boundary: BOUNDARY,
    });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    const freshNext = ctx.pending();
    const freshLoad = state.loadNextPage();
    expect(state.loadingMore()).toBe(true);

    staleNext.resolve(
      jsonResponse({
        items: [makePage({ id: 'p-old' })],
        cursor: 'c-old',
        boundary: BOUNDARY,
      })
    );
    await staleLoad;
    solid.flush();

    expect(state.rows().map((row) => row.id)).toEqual(['p2']);
    expect(state.loadingMore()).toBe(true);

    freshNext.resolve(
      jsonResponse({
        items: [makePage({ id: 'p3', read: true })],
        cursor: null,
        boundary: BOUNDARY,
      })
    );
    await freshLoad;
    solid.flush();
    expect(state.rows().map((row) => row.id)).toEqual(['p2', 'p3']);
    expect(state.loadingMore()).toBe(false);
  });
});

describe('session clear: in-flight reader load', () => {
  it('ignores article fetch resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    const articleRes = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    expect(state.openArticleId()).toBe('p1');
    expect(state.loadingArticle()).toBe(true);

    state.markUnauthenticated();
    expect(state.openArticleId()).toBeNull();
    expect(state.loadingArticle()).toBe(false);

    articleRes.resolve(jsonResponse({ item: makePage({ id: 'p1' }) }));
    await opening;
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.articleById('p1')).toBeNull();
    expect(state.loadingArticle()).toBe(false);
  });
});

describe('session clear: in-flight reader extraction', () => {
  it('ignores extraction resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1' })],
    });
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    const extractRes = ctx.pending();
    const extracting = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    state.markUnauthenticated();
    extractRes.resolve(
      jsonResponse({
        item: makeItem({
          id: 'i1',
          feedId: 'f1',
          extractedContent: '<p>extracted</p>',
        }),
      })
    );
    await extracting;
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.articleById('i1')).toBeNull();
    expect(state.extracting()).toBe(false);
    expect(state.displayMode()).toBe('default');
  });
});

describe('session clear: in-flight feed mutations', () => {
  it('ignores stale feed move, order, and reader mode changes after markUnauthenticated', async () => {
    const { state, solid, ui } = ctx;
    const feed = makeFeed({ id: 'f1', folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [feed],
    });

    const moveRes = ctx.pending();
    const orderRes = ctx.pending();
    const modeRes = ctx.pending();
    const moving = state.moveFeedToFolder(feed, 'd2');
    const ordering = state.changeFeedOrder(feed, 'oldest');
    const moding = state.changeFeedReaderMode(feed, 'extracted');

    state.markUnauthenticated();
    moveRes.resolve(noContentResponse());
    orderRes.resolve(noContentResponse());
    modeRes.resolve(noContentResponse());
    await Promise.all([moving, ordering, moding]);
    solid.flush();

    expect(state.feeds()).toEqual([]);
    expect(state.rows()).toEqual([]);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('session clear: in-flight read toggle failure', () => {
  it('prevents stale read toggle failure from rolling back a later session', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
    });
    const staleToggle = ctx.pending();
    const staleCall = state.toggleArticleRead('p1', true);

    state.markUnauthenticated();

    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: false })],
    });
    const freshToggle = ctx.pending();
    const freshCall = state.toggleArticleRead('p1', true);

    staleToggle.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await expect(staleCall).resolves.toBe(false);
    solid.flush();

    expect(state.articleById('p1')?.read).toBe(true);

    freshToggle.resolve(noContentResponse());
    await expect(freshCall).resolves.toBe(true);
    expect(state.articleById('p1')?.read).toBe(true);
  });
});
