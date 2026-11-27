import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeFolder,
  makeItem,
  makePage,
  noContentResponse,
  uuid,
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
    feeds: [makeFeed({ id: uuid(1001), folderId: 'd1' })],
    folders: [makeFolder('d1')],
    counts: [{ feedId: uuid(1001), count: 4 }],
    saved: 2,
  });
  await state.refreshSidebar();
  await ctx.queueLoadedLibrary({
    scope: { kind: 'folder', folderId: 'd1' },
    items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
    unreadOnly: true,
  });

  ctx.queue({ item: makePage({ id: uuid(1017), read: true }) });
  await state.openArticleByRoute({ kind: 'later' }, uuid(1017));
  state.toggleEmbeddedMode();
  solid.flush();
};

const assertPopulatedPreconditions = (state: typeof ctx.state): void => {
  expect(state.feeds().map((feed) => feed.id)).toEqual([uuid(1001)]);
  expect(state.folders().map((folder) => folder.id)).toEqual(['d1']);
  expect(state.savedUnreadCount()).toBe(2);
  expect(state.feedUnreadMap()).toEqual({ [uuid(1001)]: 4 });
  expect(state.rowIds()).toEqual([uuid(1007)]);
  expect(state.listBoundary()).toBe(BOUNDARY);
  expect(state.activeScope()).toEqual({ kind: 'folder', folderId: 'd1' });
  expect(state.activeUnreadOnly()).toBe(true);
  expect(state.articleById(uuid(1007))).not.toBeNull();
  expect(state.articleById(uuid(1017))).not.toBeNull();
  expect(state.openArticleId()).toBe(uuid(1017));
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

    expect(state.rowIds()).toEqual([]);
    expect(state.listBoundary()).toBeNull();
    expect(state.snapshotLoading()).toBe(false);
    expect(state.windowError()).toBeNull();
    expect(state.snapshotError()).toBeNull();
    expect(state.activeScope()).toEqual({ kind: 'later' });
    expect(state.activeUnreadOnly()).toBe(false);
    expect(state.articleById(uuid(1007))).toBeNull();
    expect(state.articleById(uuid(1017))).toBeNull();

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
      feeds: [makeFeed({ id: uuid(1001) })],
      folders: [makeFolder('d1')],
      counts: [{ feedId: uuid(1001), count: 5 }],
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

    ctx.queueSidebar({ feeds: [makeFeed({ id: uuid(1002) })] });
    await state.ensureFeeds();
    solid.flush();
    expect(state.feeds().map((feed) => feed.id)).toEqual([uuid(1002)]);
  });
});

describe('session clear: in-flight first-page load', () => {
  it('ignores first-page load resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    const page1 = ctx.pending();
    const loading = state.loadScopeFirstPage({ kind: 'later' }, false);
    expect(state.snapshotLoading()).toBe(true);

    state.markUnauthenticated();
    page1.resolve(jsonResponse({ ids: [uuid(1)], boundary: BOUNDARY }));
    await loading;
    solid.flush();

    expect(state.rowIds()).toEqual([]);
    expect(state.listBoundary()).toBeNull();
    expect(state.snapshotLoading()).toBe(false);
    expect(state.articleById(uuid(1018))).toBeNull();
  });
});

it('discards stale window content after session clear while the new session loads', async () => {
  const { state } = ctx;
  const stale = makePage({ id: uuid(2) });
  ctx.queue({ ids: [stale.id], boundary: BOUNDARY });
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  const staleBatch = ctx.pending();
  state.requestWindow({ start: 0, end: 0 });

  state.markUnauthenticated();
  state.markAuthenticated();
  const fresh = makePage({ id: uuid(5), read: true });
  ctx.queue({ ids: [fresh.id], boundary: BOUNDARY });
  await state.loadScopeFirstPage({ kind: 'later' }, false);
  const freshBatch = ctx.pending();
  state.requestWindow({ start: 0, end: 0 });

  staleBatch.resolve(jsonResponse({ items: [stale] }));
  freshBatch.resolve(jsonResponse({ items: [fresh] }));
  await vi.waitFor(() => expect(state.articleById(fresh.id)?.read).toBe(true));
  expect(state.rowIds()).toEqual([fresh.id]);
  expect(state.articleById(stale.id)).toBeNull();
  expect(state.windowError()).toBeNull();
});

describe('session clear: in-flight reader load', () => {
  it('ignores article fetch resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    const articleRes = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    expect(state.openArticleId()).toBe(uuid(1018));
    expect(state.loadingArticle()).toBe(true);

    state.markUnauthenticated();
    expect(state.openArticleId()).toBeNull();
    expect(state.loadingArticle()).toBe(false);

    articleRes.resolve(jsonResponse({ item: makePage({ id: uuid(1018) }) }));
    await opening;
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.articleById(uuid(1018))).toBeNull();
    expect(state.loadingArticle()).toBe(false);
  });
});

describe('session clear: in-flight reader extraction', () => {
  it('ignores extraction resolving after markUnauthenticated', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
      feeds: [makeFeed({ id: uuid(1001) })],
    });
    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
    solid.flush();

    const extractRes = ctx.pending();
    const extracting = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    state.markUnauthenticated();
    extractRes.resolve(
      jsonResponse({
        item: makeItem({
          id: uuid(1007),
          feedId: uuid(1001),
          extractedContent: '<p>extracted</p>',
        }),
      })
    );
    await extracting;
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.articleById(uuid(1007))).toBeNull();
    expect(state.extracting()).toBe(false);
    expect(state.displayMode()).toBe('default');
  });
});

describe('session clear: in-flight feed mutations', () => {
  it('ignores stale feed move, order, and reader mode changes after markUnauthenticated', async () => {
    const { state, solid, ui } = ctx;
    const feed = makeFeed({ id: uuid(1001), folderId: 'd1' });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'd1' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001) })],
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
    expect(state.rowIds()).toEqual([]);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('session clear: in-flight read toggle failure', () => {
  it('prevents stale read toggle failure from rolling back a later session', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: false })],
    });
    const staleToggle = ctx.pending();
    const staleCall = state.toggleArticleRead(uuid(1018), true);

    state.markUnauthenticated();

    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: false })],
    });
    const freshToggle = ctx.pending();
    const freshCall = state.toggleArticleRead(uuid(1018), true);

    staleToggle.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
    await expect(staleCall).resolves.toBe(false);
    solid.flush();

    expect(state.articleById(uuid(1018))?.read).toBe(true);

    freshToggle.resolve(noContentResponse());
    await expect(freshCall).resolves.toBe(true);
    expect(state.articleById(uuid(1018))?.read).toBe(true);
  });
});
