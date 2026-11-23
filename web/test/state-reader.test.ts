import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeItem,
  makePage,
  noContentResponse,
} from './support/state-fixture';

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

describe('cached article', () => {
  it('renders a cached row immediately and then refreshes it from the server', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true, title: 'Cached' })],
    });

    const remote = ctx.pending();
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    expect(state.openArticle()?.title).toBe('Cached');
    expect(state.loadingArticle()).toBe(true);

    remote.resolve(
      jsonResponse({ item: makePage({ id: 'p1', read: true, title: 'Fresh' }) })
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
      items: [makePage({ id: 'p1', read: true })],
    });

    ctx.queue({ item: null });
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
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
    });

    const slow = ctx.pending();
    const openingA = state.openArticleByRoute({ kind: 'all' }, 'i1');
    ctx.queue({ item: makeItem({ id: 'i2', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'all' }, 'i2');
    solid.flush();

    slow.resolve(
      jsonResponse({
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
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: 'p1' }) });
    ctx.queueEmpty();

    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);
    expect(ctx.requestUrl(1)).toBe('/api/saved-pages/p1');
    expect(ctx.requestInit(1).method).toBe('PATCH');
  });
});

describe('read on open before slow list snapshot', () => {
  it('keeps read-on-open when detail resolves and PATCHes before slow page 1 returns', async () => {
    const { state, solid } = ctx;
    const page1 = ctx.pending();
    const detail = ctx.pending();

    const loadingList = state.loadScopeFirstPage({ kind: 'later' }, false);
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    ctx.queueEmpty();
    detail.resolve(jsonResponse({ item: makePage({ id: 'p1', read: false }) }));
    await opening;
    solid.flush();

    expect(state.openArticle()?.read).toBe(true);

    page1.resolve(
      jsonResponse({
        items: [
          makePage({ id: 'p1', read: false }),
          makePage({ id: 'p2', read: false }),
        ],
        cursor: null,
      })
    );
    await loadingList;
    solid.flush();

    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});

describe('slow list snapshot before read on open', () => {
  it('marks read-on-open when page 1 returns before detail', async () => {
    const { state, solid } = ctx;
    const page1 = ctx.pending();
    const detail = ctx.pending();

    const loadingList = state.loadScopeFirstPage({ kind: 'later' }, false);
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    page1.resolve(
      jsonResponse({
        items: [
          makePage({ id: 'p1', read: false }),
          makePage({ id: 'p2', read: false }),
        ],
        cursor: null,
      })
    );
    await loadingList;
    solid.flush();

    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(false);

    ctx.queueEmpty();
    detail.resolve(jsonResponse({ item: makePage({ id: 'p1', read: false }) }));
    await opening;
    solid.flush();

    expect(state.rows().find((row) => row.id === 'p1')?.read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});

describe('local toggle during detail load', () => {
  it('preserves a local read toggle made while detail fetch is still in flight', async () => {
    const { state, solid } = ctx;
    const page1 = ctx.pending();
    const detail = ctx.pending();

    const loadingList = state.loadScopeFirstPage({ kind: 'later' }, false);
    const opening = state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();

    page1.resolve(
      jsonResponse({
        items: [makePage({ id: 'p1', read: false })],
        cursor: null,
      })
    );
    await loadingList;

    const patch = ctx.pending();
    const toggling = state.toggleArticleRead('p1', true);
    patch.resolve(noContentResponse());
    await toggling;
    solid.flush();

    const beforeDetail = ctx.fetchCount();
    detail.resolve(jsonResponse({ item: makePage({ id: 'p1', read: false }) }));
    await opening;
    solid.flush();

    expect(ctx.fetchCount()).toBe(beforeDetail);
    expect(state.rows()[0].read).toBe(true);
    expect(state.openArticle()?.read).toBe(true);
  });
});
