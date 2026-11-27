import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeItem,
  makePage,
  mountLibraryViewport,
  noContentResponse,
  savedOrder,
  uuid,
} from './support/state-fixture';

const BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('empty route', () => {
  it('clears the reader when the route has no article', async () => {
    const { state, solid } = ctx;
    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('embedded');

    await state.openArticleByRoute({ kind: 'later' }, null);
    solid.flush();

    expect(state.openArticleId()).toBeNull();
    expect(state.openArticle()).toBeNull();
    expect(state.displayMode()).toBe('default');
    expect(ctx.fetchCount()).toBe(0);
  });
});

it('prepends a feed item saved after opening Read Later and counts it once', async () => {
  const { state, solid } = ctx;
  await ctx.queueLoadedLibrary({ scope: { kind: 'all' }, items: [] });
  const save = ctx.pending();
  const saving = state.saveFeedItemToLater(uuid(1007));
  const existing = makePage({ id: uuid(1018) });
  const saved = makePage({ id: uuid(1019) });
  await ctx.queueLoadedLibrary({
    scope: { kind: 'later' },
    unreadOnly: true,
    items: [existing],
    feeds: [],
    saved: 1,
  });
  expect(Array.from(state.rowIds())).toEqual([existing.id]);

  const refresh = ctx.queueDeferredSidebar({ saved: 2 });
  save.resolve(jsonResponse({ item: saved }, 201));
  await saving;
  solid.flush();

  expect(Array.from(state.rowIds())).toEqual([saved.id, existing.id]);
  expect(state.savedUnreadCount()).toBe(2);

  refresh.resolve();
  await state.refreshSidebar();
  solid.flush();

  expect(state.savedUnreadCount()).toBe(2);
});

describe('cached article', () => {
  it('renders a cached row immediately and then refreshes it from the server', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: true, title: 'Cached' })],
    });

    const remote = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    expect(state.openArticle()?.title).toBe('Cached');
    expect(state.loadingArticle()).toBe(true);

    remote.resolve(
      jsonResponse({
        item: makePage({ id: uuid(1018), read: true, title: 'Fresh' }),
      })
    );
    await opening;
    solid.flush();

    expect(state.openArticle()?.title).toBe('Fresh');
    expect(state.loadingArticle()).toBe(false);
  });
});

describe('missing article', () => {
  it('renders the empty reader when the remote lookup returns null', async () => {
    const { state, solid, ui } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: true })],
    });

    ctx.queue({ item: null });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    expect(state.openArticleId()).toBe(uuid(1018));
    expect(state.openArticle()).toBeNull();
    expect(state.loadingArticle()).toBe(false);
    expect(ui.currentToast()).toBeNull();
  });
});

describe('latest navigation', () => {
  it('lets the latest navigation win over a slow earlier response', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
    });

    const slow = ctx.pending();
    const openingA = state.openArticleByRoute({ kind: 'all' }, uuid(1007));
    ctx.queue({
      item: makeItem({ id: uuid(1008), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute({ kind: 'all' }, uuid(1008));
    solid.flush();

    slow.resolve(
      jsonResponse({
        item: makeItem({
          id: uuid(1007),
          feedId: uuid(1001),
          read: true,
          title: 'Stale',
        }),
      })
    );
    await openingA;
    solid.flush();

    expect(state.openArticleId()).toBe(uuid(1008));
    expect(state.openArticle()?.id).toBe(uuid(1008));
  });
});

describe('read on open', () => {
  it('marks an opened unread article read', async () => {
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: uuid(1018) }) });
    ctx.queueEmpty();

    await state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);
    expect(ctx.requestUrl(1)).toBe(`/api/saved-pages/${uuid(1018)}`);
    expect(ctx.requestInit(1).method).toBe('PATCH');
  });
});

describe('read on open before slow list snapshot', () => {
  it('keeps read-on-open when detail resolves and PATCHes before slow page 1 returns', async () => {
    const { state, solid } = ctx;
    const items = [makePage({ id: uuid(1018) }), makePage({ id: uuid(1019) })];
    ctx.queue(savedOrder(items, BOUNDARY));
    const page1 = ctx.pending();
    const detail = ctx.pending();

    await state.loadScopeFirstPage({ kind: 'later' }, false);
    state.requestWindow({ start: 0, end: 0 });
    expect(ctx.fetchCount()).toBe(2);
    const opening = state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    ctx.queueEmpty();
    detail.resolve(
      jsonResponse({ item: makePage({ id: uuid(1018), read: false }) })
    );
    await opening;
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);

    page1.resolve(jsonResponse({ items }));
    await vi.waitFor(() =>
      expect(state.articleById(uuid(1019))).not.toBeNull()
    );
    solid.flush();

    expect(state.articleById(uuid(1018))?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});

describe('slow list snapshot before read on open', () => {
  it('marks read-on-open when page 1 returns before detail', async () => {
    const { state, solid } = ctx;
    const items = [makePage({ id: uuid(1018) }), makePage({ id: uuid(1019) })];
    ctx.queue(savedOrder(items, BOUNDARY));
    const page1 = ctx.pending();
    const detail = ctx.pending();

    await state.loadScopeFirstPage({ kind: 'later' }, false);
    state.requestWindow({ start: 0, end: 0 });
    expect(ctx.fetchCount()).toBe(2);
    const opening = state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    page1.resolve(jsonResponse({ items }));
    await vi.waitFor(() =>
      expect(state.articleById(uuid(1018))).not.toBeNull()
    );
    solid.flush();

    expect(state.articleById(uuid(1018))?.read).toBe(false);

    ctx.queueEmpty();
    detail.resolve(
      jsonResponse({ item: makePage({ id: uuid(1018), read: false }) })
    );
    await opening;
    solid.flush();

    expect(state.articleById(uuid(1018))?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});

describe('local toggle during detail load', () => {
  it('preserves a local read toggle made while detail fetch is still in flight', async () => {
    const { state, solid } = ctx;
    const items = [makePage({ id: uuid(1018) })];
    ctx.queue(savedOrder(items, BOUNDARY));
    const page1 = ctx.pending();
    const detail = ctx.pending();

    await state.loadScopeFirstPage({ kind: 'later' }, false);
    state.requestWindow({ start: 0, end: 0 });
    expect(ctx.fetchCount()).toBe(2);
    const opening = state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();

    page1.resolve(jsonResponse({ items }));
    await vi.waitFor(() =>
      expect(state.articleById(uuid(1018))).not.toBeNull()
    );

    const patch = ctx.pending();
    const toggling = state.toggleArticleRead(uuid(1018), true);
    patch.resolve(noContentResponse());
    await toggling;
    solid.flush();

    const beforeDetail = ctx.fetchCount();
    detail.resolve(
      jsonResponse({ item: makePage({ id: uuid(1018), read: false }) })
    );
    await opening;
    solid.flush();

    expect(ctx.fetchCount()).toBe(beforeDetail);
    expect(state.articleById(state.rowIds()[0])?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});

describe('refreshOpenArticle on mark-all', () => {
  it('refreshes open article in scope without resetting mode, selection, or auto-marking read', async () => {
    const { state, solid } = ctx;
    const release = mountLibraryViewport(state);
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: false })],
      feeds: [],
      saved: 1,
    });
    ctx.queue({ item: makePage({ id: uuid(1018), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    state.toggleEmbeddedMode();
    ctx.queueEmpty();
    const opened = state.openArticle();
    expect(opened).not.toBeNull();
    if (opened !== null) await state.toggleOpenArticleRead(opened, false);
    solid.flush();
    expect(state.openArticle()?.read).toBe(false);

    const beforeMark = ctx.fetchCount();
    ctx.queueEmpty();
    const items = [makePage({ id: uuid(1018), read: true })];
    ctx.queue(savedOrder(items, BOUNDARY));
    ctx.queue({ item: items[0] });
    ctx.queue({ items });

    await state.markScopeAllRead({ kind: 'later' });
    solid.flush();

    const urls = ctx.fetchMock.mock.calls
      .slice(beforeMark)
      .map(([url]) => String(url));
    expect(urls).toContain(`/api/saved-pages/${uuid(1018)}`);
    expect(
      ctx.fetchMock.mock.calls
        .slice(beforeMark)
        .some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
        )
    ).toBe(false);
    expect(state.openArticleId()).toBe(uuid(1018));
    expect(state.displayMode()).toBe('embedded');
    expect(state.openArticle()?.read).toBe(true);
    release();
  });
});

describe('refreshOpenArticle scope guard and stale drop', () => {
  it('skips detail fetch when open article is outside marked scope and drops stale refreshes', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: true })],
    });
    ctx.queue({ item: makePage({ id: uuid(1018), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1018));

    const beforeOther = ctx.fetchCount();
    await state.refreshOpenArticle((row) => row.kind === 'feed');
    expect(ctx.fetchCount()).toBe(beforeOther);

    const slowRefresh = ctx.pending();
    const refreshing = state.refreshOpenArticle((row) => row.kind === 'later');
    ctx.queue({ item: makePage({ id: uuid(1019), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1019));
    slowRefresh.resolve(
      jsonResponse({
        item: makePage({ id: uuid(1018), read: true, title: 'Old' }),
      })
    );
    await refreshing;
    solid.flush();
    expect(state.openArticleId()).toBe(uuid(1019));
  });
});
